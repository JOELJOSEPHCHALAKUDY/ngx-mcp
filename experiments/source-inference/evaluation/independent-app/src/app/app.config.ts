import { ApplicationConfig, inject, provideAppInitializer } from '@angular/core';
import { provideRouter } from '@angular/router';
import { routes } from './app.routes';
import { ContactService } from './contact.service';

export const appConfig: ApplicationConfig = {
  providers: [provideRouter(routes), provideAppInitializer(() => { inject(ContactService); })],
};
