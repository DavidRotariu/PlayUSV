import { app } from './app';
import { config } from './config';

app.listen(config.port, () => {
  console.log(`API: http://localhost:${config.port}/api  ·  Swagger: http://localhost:${config.port}/api/docs`);
});
