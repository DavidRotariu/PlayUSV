# Campus Sports Booking

Aplicație web pentru rezervarea bazelor sportive ale USV (bazin, sală de fitness, teren de fotbal, terenuri de baschet), în intervale de 30 de minute.

Monorepo cu npm workspaces:

```
apps/api   backend REST (TypeScript, Express, Prisma, PostgreSQL pe Neon)
apps/web   frontend (urmează)
openapi.yaml   contractul API-ului, servit la /api/docs
```

În `apps/api/src`, fiecare zonă (`users`, `facilities`, `bookings`, `maintenance`) are trei straturi:

- `*.routes.ts`: doar HTTP (validare cu Zod, apel la service, forma răspunsului);
- `*.service.ts`: regulile de business;
- `*.repository.ts`: tot accesul la baza de date prin Prisma.

În plus: `auth/` (Google + JWT), `middleware/` (autentificare, rol de admin, handler central de erori care întoarce mereu `{ code, message }`), `lib/` (timp, erori, Prisma).

## Instalare

Cerințe: Node.js 24 LTS (minim 22.9) și npm.

```bash
npm install
```

## Configurare `.env`

```bash
cp apps/api/.env.example apps/api/.env
```

Completează `apps/api/.env` (fișierul nu se urcă în git):

| Variabilă                | Ce este                                                                                        |
| ------------------------ | ---------------------------------------------------------------------------------------------- |
| `DATABASE_URL`           | Conexiunea Neon **prin pooler** (host cu `-pooler`). Folosită de aplicație.                    |
| `DIRECT_URL`             | Conexiunea Neon **directă** (fără `-pooler`). Folosită de Prisma la migrări.                   |
| `DATABASE_URL_TEST`      | Baza de date pentru teste: un branch Neon separat sau un Postgres local. **Testele o golesc.** |
| `GOOGLE_CLIENT_ID`       | Client ID-ul OAuth din Google Cloud Console.                                                   |
| `JWT_SECRET`             | Cheie lungă și aleatoare pentru JWT-urile aplicației.                                          |
| `ADMIN_EMAILS`           | Emailurile cu rol ADMIN, separate prin virgulă.                                                |
| `PORT`                   | Portul serverului (implicit 3000).                                                             |
| `NODE_ENV`               | `development` activează `POST /api/auth/dev-login`. Nu îl seta așa în producție.               |
| `BOOKING_MAX_DAYS_AHEAD` | Cu câte zile în avans se poate rezerva (implicit 14).                                          |
| `CANCEL_CUTOFF_MINUTES`  | Cu câte minute înainte de început se mai poate anula (implicit 0).                             |

Ambele URL-uri Neon se găsesc în consola Neon → **Connect** (bifează/debifează „Connection pooling”).

## Migrări și seed pe Neon

```bash
npm run db:migrate   # aplică migrările (prisma migrate deploy, folosește DIRECT_URL)
npm run db:seed      # ATENȚIE: șterge toate datele și pune date demo
npm run db:studio    # interfață vizuală pentru baza de date
```

Seed-ul creează cele 4 baze cu regulile lor, terenurile de baschet „Terenul 1” și „Terenul 2”, utilizatorii de test și rezervări pentru zilele următoare (inclusiv un interval de bazin complet mâine la 18:00 și o rezervare anulată).

Utilizatori de test: `admin@usm.ro` (ADMIN), `mihai.ionescu@usm.ro` și `elena.rusu@usm.ro` (TEACHER), `student1@student.usv.ro` … `student12@student.usv.ro` (STUDENT).

O migrare nouă, după ce modifici `prisma/schema.prisma`:

```bash
cd apps/api && npx prisma migrate dev --name descriere-scurta
```

## Pornire

```bash
npm run dev          # dezvoltare, cu reîncărcare automată
npm run build && npm start   # producție
```

API-ul rulează la `http://localhost:3000/api`.

## Swagger UI

Deschide `http://localhost:3000/api/docs`. Apasă **Authorize** și lipește un token (vezi mai jos).

## Token de dezvoltare

Cât timp `NODE_ENV=development`, există ruta `POST /api/auth/dev-login` (nu apare în `openapi.yaml`). Primește un email și întoarce un JWT, fără Google. Regulile de domeniu și de cont blocat se aplică la fel ca la login-ul real.

```bash
curl -X POST http://localhost:3000/api/auth/dev-login -H "Content-Type: application/json" -d "{\"email\":\"student1@student.usv.ro\"}"
```

Folosește `token` din răspuns în antetul `Authorization: Bearer <token>`.

## Teste

```bash
npm test
```

Testele rulează pe `DATABASE_URL_TEST` (aplică migrările automat și golesc tabelele între teste). Refuză să pornească dacă `DATABASE_URL_TEST` lipsește sau este aceeași cu baza principală. Conțin:

- teste unitare pentru regulile de rezervare (fiecare cod de eroare, limitele de la 18:00 și de la limita zilnică, închiderea la miezul nopții);
- teste API cu Supertest (login, sloturi, rezervare, anulare, mentenanță cu anulare automată);
- testul de concurență: 10 cereri simultane pentru ultimul loc la bazin, din care doar una reușește.

```bash
npm run lint        # ESLint + Prettier
npm run typecheck   # tsc
```

## Setări încă nedecise de client

| Regulă                                 | Implicit                       | Variabilă                                           |
| -------------------------------------- | ------------------------------ | --------------------------------------------------- |
| Cu câte zile în avans se poate rezerva | 14 zile                        | `BOOKING_MAX_DAYS_AHEAD`                            |
| Până când se poate anula o rezervare   | până la începutul intervalului | `CANCEL_CUTOFF_MINUTES` (minute înainte de început) |

## Decizii tehnice

**Stocarea orelor.** Orele (`openTime`, `closeTime`, `startTime`, `endTime`) sunt numere întregi: minute de la miezul nopții, ora României (Europe/Bucharest). Rezervarea are și o coloană `date` (ziua calendaristică locală). Regulile sunt toate „pe ora de pe ceas” (18:00, programul, limita pe zi), așa că devin simple comparații de numere. Ora de închidere/sfârșit `00:00` se salvează ca `1440` (miezul nopții de la sfârșitul zilei). Trecerea la ora de vară/iarnă (03:00/04:00) cade când bazele sunt închise, deci nu creează ore ambigue. Perioadele de mentenanță folosesc `timestamptz`, fiindcă pot dura mai multe zile.

**Concurența.** `POST /bookings` face toate verificările și inserarea într-o singură tranzacție Prisma care blochează (`SELECT … FOR UPDATE`) mai întâi rândul utilizatorului, apoi rândul unității. Două cereri pentru aceeași unitate așteaptă una după alta, iar a doua vede rezervarea primei, deci capacitatea nu poate fi depășită. Blocarea utilizatorului împiedică depășirea limitei zilnice prin rezervări simultane pe terenuri diferite. Crearea unei mentenanțe blochează toate unitățile bazei, ca să nu intre o rezervare în timp ce perioada este creată.

**Statusul COMPLETED** nu se salvează: o rezervare ACTIVE al cărei interval s-a încheiat este afișată ca COMPLETED.

**Ștergerea unei baze** este logică (`archivedAt`), ca istoricul rezervărilor să rămână. Același lucru pentru unitățile eliminate la editare.

## Coduri de eroare adăugate față de prima versiune a specificației

`BOOKING_IN_PAST`, `BOOKING_TOO_FAR_AHEAD`, `ALREADY_BOOKED` (aceeași persoană, același interval, aceeași bază), `BOOKING_NOT_CANCELLABLE`, `FACILITY_HAS_ACTIVE_BOOKINGS`, `MAINTENANCE_OVERLAP`. Toate sunt documentate în `openapi.yaml`.
