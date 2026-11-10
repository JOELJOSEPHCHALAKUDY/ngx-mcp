import { NgModule } from '@angular/core';
import { BrowserModule } from '@angular/platform-browser';
import { HTTP_INTERCEPTORS, provideHttpClient, withInterceptorsFromDi } from '@angular/common/http';
import { AppRoutingModule } from './app-routing.module';
import { MaterialModule } from './material.module';
import { AppComponent } from './app.component';
import { ReportsComponent } from './reports.component';
import { FakeApiInterceptor } from './fake-api.interceptor';

@NgModule({
  declarations: [AppComponent, ReportsComponent],
  imports: [BrowserModule, AppRoutingModule, MaterialModule],
  providers: [
    provideHttpClient(withInterceptorsFromDi()),
    { provide: HTTP_INTERCEPTORS, useClass: FakeApiInterceptor, multi: true },
  ],
  bootstrap: [AppComponent],
})
export class AppModule {}
