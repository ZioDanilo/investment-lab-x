import { CommonModule } from '@angular/common';
import { Component, inject, OnInit, OnDestroy } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterModule } from '@angular/router';
import { ApiService } from '../../core/api/api.service';
import { PortfolioSelectionService } from '../../core/services/portfolio-selection.service';
import { AdRailComponent } from '../../shared/components/ad-rail.component';

@Component({
  selector: 'app-login-page',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterModule, AdRailComponent],
  templateUrl: './login-page.component.html',
  styleUrls: ['./login-page.component.css']
})
export class LoginPageComponent implements OnInit, OnDestroy {
  private readonly router = inject(Router);
  private readonly apiService = inject(ApiService);
  private readonly portfolioSelection = inject(PortfolioSelectionService);

  currentMessageIndex = 0;
  outgoingMessageIndex: number | null = null;
  private outgoingCleanupTimer?: ReturnType<typeof setTimeout>;
  private pendingMessages: number[] = [];
  private rotationTimer?: ReturnType<typeof setTimeout>;
  private rotationDeadline = 0;
  private rotationRemaining = 7000;

  private rotateMessage(): void {
    if (this.pendingMessages.length === 0) {
      this.pendingMessages = Array.from({ length: 19 }, (_, index) => index)
        .filter(index => index !== this.currentMessageIndex);
      for (let i = this.pendingMessages.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [this.pendingMessages[i], this.pendingMessages[j]] =
          [this.pendingMessages[j], this.pendingMessages[i]];
      }
    }
    this.outgoingMessageIndex = this.currentMessageIndex;
    this.currentMessageIndex = this.pendingMessages.pop() ?? 0;
    if (this.outgoingCleanupTimer) clearTimeout(this.outgoingCleanupTimer);
    this.outgoingCleanupTimer = setTimeout(() => { this.outgoingMessageIndex = null; }, 700);
    this.rotationRemaining = 7000;
    this.resumeRotation();
  }

  pauseRotation(): void {
    if (this.rotationTimer) clearTimeout(this.rotationTimer);
    this.rotationTimer = undefined;
    this.rotationRemaining = Math.max(0, this.rotationDeadline - Date.now());
  }

  resumeRotation(): void {
    if (this.rotationTimer) clearTimeout(this.rotationTimer);
    this.rotationDeadline = Date.now() + this.rotationRemaining;
    this.rotationTimer = setTimeout(() => this.rotateMessage(), this.rotationRemaining);
  }

  ngOnDestroy(): void {
    if (this.outgoingCleanupTimer) clearTimeout(this.outgoingCleanupTimer);
    if (this.rotationTimer) clearTimeout(this.rotationTimer);
    if (this.emailCheckTimer) clearTimeout(this.emailCheckTimer);
    if (this.usernameCheckTimer) clearTimeout(this.usernameCheckTimer);
    if (this.backendProgressTimer) clearInterval(this.backendProgressTimer);
    if (this.backendFinishTimer) clearTimeout(this.backendFinishTimer);
  }

  landingStats: { users: number | null; portfolios: number | null; etfs: number | null; operations: number | null } = { users: null, portfolios: null, etfs: null, operations: null };
  landingStatsError = '';
  backendLoading = true;
  backendProgress = 0;
  private backendStartedAt = 0;
  private backendProgressTimer?: ReturnType<typeof setInterval>;
  private backendFinishTimer?: ReturnType<typeof setTimeout>;

  private startBackendProgress(): void {
    this.backendStartedAt = Date.now();
    this.backendProgressTimer = setInterval(() => {
      const elapsed = Date.now() - this.backendStartedAt;
      this.backendProgress = elapsed <= 20000
        ? Math.min(80, elapsed / 250)
        : Math.min(98, 80 + Math.floor((elapsed - 20000) / 10000) * 2);
    }, 100);
  }

  private finishBackendProgress(success: boolean): void {
    if (this.backendProgressTimer) clearInterval(this.backendProgressTimer);
    this.backendProgressTimer = undefined;
    if (!success) { this.backendLoading = false; return; }
    this.backendProgress = 100;
    this.backendFinishTimer = setTimeout(() => {
      this.backendLoading = false;
      this.backendFinishTimer = undefined;
    }, 350);
  }

  ngOnInit(): void {
    this.currentMessageIndex = Math.floor(Math.random() * 18);
    this.resumeRotation();
    this.startBackendProgress();
    this.apiService.getLandingStats().subscribe({
      next: (response: any) => {
        if (!response?.success || !response?.data) {
          this.finishBackendProgress(false);
          this.landingStatsError = 'Statistiche non disponibili: risposta del servizio non valida.';
          return;
        }
        const data = response.data;
        const parseCount = (value: unknown): number | null => {
          if (value === null || value === undefined || value === '') return null;
          const count = Number(value);
          return Number.isSafeInteger(count) && count >= 0 ? count : null;
        };
        this.landingStats = {
          users: parseCount(data.users),
          portfolios: parseCount(data.portfolios),
          etfs: parseCount(data.etfs),
          operations: parseCount(data.operations)
        };
        if (Object.values(this.landingStats).some(value => value === null)) {
          this.finishBackendProgress(false);
          this.landingStatsError = 'Alcuni conteggi non sono stati restituiti dal servizio.';
        } else {
          this.landingStatsError = '';
          this.finishBackendProgress(true);
        }
      },
      error: (error: any) => {
        this.finishBackendProgress(false);
        this.landingStatsError = 'Statistiche non disponibili (HTTP ' + (error?.status || 'rete') + ').';
        console.error('Errore caricamento statistiche landing', error);
      }
    });
  }

  monteCarloDiagnosticsLoading = false;
  monteCarloDiagnosticsOpen = false;
  monteCarloDiagnosticsError = '';
  monteCarloDiagnosticsReport: any = null;

  runMonteCarloDiagnostics(): void {
    if (this.monteCarloDiagnosticsLoading) return;
    this.monteCarloDiagnosticsLoading = true;
    this.monteCarloDiagnosticsError = '';
    this.monteCarloDiagnosticsReport = null;
    this.monteCarloDiagnosticsOpen = true;
    this.apiService.getMonteCarloDiagnostics().subscribe({
      next: (response: any) => {
        this.monteCarloDiagnosticsLoading = false;
        if (response?.success && response?.data) this.monteCarloDiagnosticsReport = response.data;
        else this.monteCarloDiagnosticsError = 'Risposta diagnostica non valida.';
      },
      error: (error: any) => {
        this.monteCarloDiagnosticsLoading = false;
        this.monteCarloDiagnosticsError = error?.error?.error ||
          ('Diagnostica non disponibile (HTTP ' + (error?.status || 'rete') + ').');
      }
    });
  }

  closeMonteCarloDiagnostics(): void { this.monteCarloDiagnosticsOpen = false; }

  copyMonteCarloDiagnostics(): void {
    if (!this.monteCarloDiagnosticsReport) return;
    void navigator.clipboard.writeText(JSON.stringify(this.monteCarloDiagnosticsReport, null, 2))
      .catch(() => { this.monteCarloDiagnosticsError = 'Copia non disponibile: seleziona il JSON e copialo manualmente.'; });
  }

  get monteCarloDiagnosticsJson(): string {
    return this.monteCarloDiagnosticsReport ? JSON.stringify(this.monteCarloDiagnosticsReport, null, 2) : '';
  }

  factorAuditLoading = false;
  factorAuditOpen = false;
  factorAuditError = '';
  factorAuditReport: any = null;

  runFactorAudit(): void {
    if (this.factorAuditLoading) return;
    this.factorAuditLoading = true;
    this.factorAuditError = '';
    this.factorAuditOpen = true;
    this.apiService.getFactorAudit().subscribe({
      next: (response: any) => {
        this.factorAuditLoading = false;
        if (response?.success && response?.data) {
          this.factorAuditReport = response.data;
        } else {
          this.factorAuditError = 'Risposta diagnostica non valida.';
        }
      },
      error: (error: any) => {
        this.factorAuditLoading = false;
        this.factorAuditError = error?.error?.error ||
          ('Audit non disponibile (HTTP ' + (error?.status || 'rete') + ').');
      }
    });
  }

  closeFactorAudit(): void { this.factorAuditOpen = false; }

  copyFactorAudit(): void {
    if (!this.factorAuditReport) return;
    void navigator.clipboard.writeText(JSON.stringify(this.factorAuditReport, null, 2))
      .catch(() => { this.factorAuditError = 'Copia non disponibile: seleziona il JSON e copialo manualmente.'; });
  }

  get factorAuditJson(): string {
    return this.factorAuditReport ? JSON.stringify(this.factorAuditReport, null, 2) : '';
  }

  username = '';
  password = '';
  email = '';
  birthDay = '';
  birthMonth = '';
  birthYear = '';
  readonly birthDays = Array.from({length:31},(_,i)=>i+1);
  readonly birthMonths = [
    'Gennaio','Febbraio','Marzo','Aprile','Maggio','Giugno',
    'Luglio','Agosto','Settembre','Ottobre','Novembre','Dicembre'
  ];
  readonly birthYears = Array.from({length:127},(_,i)=>new Date().getFullYear()-i);
  get registrationValid():boolean {
    if(!this.email.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(this.email.trim()))return false;
    const y=Number(this.birthYear),m=Number(this.birthMonth),d=Number(this.birthDay);
    if(!y||!m||!d)return false;
    const date=new Date(y,m-1,d);
    const today=new Date();
    const adultCutoff=new Date(today.getFullYear()-18,today.getMonth(),today.getDate());
    return date.getFullYear()===y && date.getMonth()===m-1 && date.getDate()===d && date.getTime()<=adultCutoff.getTime();
  }
  get birthDate():string {
    return this.birthYear+'-'+this.birthMonth.padStart(2,'0')+'-'+this.birthDay.padStart(2,'0');
  }
  registerMode = false;
  submitting = false;
  authError = '';
  authSuccess = '';
  usernameTaken = false;
  emailTaken = false;
  emailChecking = false;
  emailVerified = '';
  emailCheckError = false;
  emailCheckErrorMessage = '';
  usernameChecking = false;
  usernameVerified = '';
  usernameCheckError = false;
  private emailCheckTimer?: ReturnType<typeof setTimeout>;
  private usernameCheckTimer?: ReturnType<typeof setTimeout>;

  setRegisterMode(registerMode: boolean): void {
    if (this.submitting) return;
    this.registerMode = registerMode;
    this.authError = '';
    this.authSuccess = '';
    this.usernameTaken = false;
    this.emailTaken = false;
    this.emailVerified = '';
    this.emailCheckError = false;
    this.emailCheckErrorMessage = '';
    this.usernameVerified = '';
    this.usernameCheckError = false;
    this.usernameChecking = false;
    if (this.emailCheckTimer) clearTimeout(this.emailCheckTimer);
    if (this.usernameCheckTimer) clearTimeout(this.usernameCheckTimer);
    if (registerMode) {
      // Fields may already be populated from the login tab or browser autofill.
      if (this.username.trim()) this.onUsernameChange(this.username);
      if (this.email.trim()) this.onEmailChange(this.email);
    }
  }

  get emailFormatInvalid(): boolean {
    return !!this.email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(this.email.trim());
  }

  get birthDateError(): string {
    const y=Number(this.birthYear),m=Number(this.birthMonth),d=Number(this.birthDay);
    if(!y||!m||!d)return '';
    const date=new Date(y,m-1,d);
    if(date.getFullYear()!==y || date.getMonth()!==m-1 || date.getDate()!==d)return 'Data di nascita non valida.';
    const now=new Date();
    const limit=new Date(now.getFullYear()-18,now.getMonth(),now.getDate());
    return date>limit?'Devi aver compiuto almeno 18 anni.':'';
  }

  onEmailChange(value: string): void {
    this.emailTaken = false;
    this.emailVerified = '';
    this.emailCheckError = false;
    this.emailCheckErrorMessage = '';
    this.authError = '';
    if (this.emailCheckTimer) clearTimeout(this.emailCheckTimer);
    if (!this.registerMode) return;
    const email = String(value ?? '').trim();
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      this.emailChecking = false;
      return;
    }
    this.emailChecking = true;
    this.emailCheckTimer = setTimeout(() => this.checkEmailAvailability(), 350);
  }

  checkEmailAvailability(): void {
    if (!this.registerMode) return;
    const email = this.email.trim().toLowerCase();
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { this.emailChecking = false; return; }
    if (this.emailVerified === email && !this.emailCheckError) return;
    this.emailChecking = true;
    this.apiService.checkEmailAvailability(email).subscribe({
      next: (response: any) => {
        if (this.email.trim().toLowerCase() !== email) return;
        this.emailTaken = response?.data?.available === false;
        this.emailCheckError = response?.success !== true || typeof response?.data?.available !== 'boolean';
        this.emailCheckErrorMessage = this.emailCheckError ? 'Risposta non valida dal servizio di verifica email.' : '';
        this.emailVerified = !this.emailCheckError && !this.emailTaken ? email : '';
        this.emailChecking = false;
      },
      error: (error: any) => {
        if (this.email.trim().toLowerCase() !== email) return;
        this.emailChecking = false;
        this.emailCheckError = true;
        const status = Number(error?.status || 0);
        this.emailCheckErrorMessage = status === 404 ? 'Servizio di verifica email non trovato (HTTP 404): aggiornare il backend.' : status === 500 ? 'Errore del servizio di verifica email (HTTP 500): controllare il backend e il database.' : status === 0 ? 'Servizio email non raggiungibile: controllare connessione e CORS.' : 'Verifica email non disponibile (HTTP ' + status + ').';
        this.emailVerified = '';
        console.error('Verifica disponibilità email fallita', error?.status, error?.error);
      }
    });
  }

  onUsernameChange(value: string): void {
    this.usernameTaken = false;
    this.usernameVerified = '';
    this.usernameCheckError = false;
    this.authError = '';
    if (this.usernameCheckTimer) clearTimeout(this.usernameCheckTimer);
    if (!this.registerMode) return;

    if (this.usernameCheckTimer) clearTimeout(this.usernameCheckTimer);
    const username = String(value ?? '').trim();
    if (!username) { this.usernameChecking = false; return; }
    this.usernameChecking = true;

    this.usernameCheckTimer = setTimeout(() => this.checkUsernameAvailability(), 350);
  }

  checkUsernameAvailability(): void {
    if (!this.registerMode) return;
    const username = this.username.trim();
    if (!username) {
      this.usernameTaken = false;
      this.usernameChecking = false;
      return;
    }
    if (this.usernameVerified === username.toLowerCase() && !this.usernameCheckError) return;
    this.usernameChecking = true;
    this.apiService.checkUsernameAvailability(username).subscribe({
      next: (response: any) => {
        if (this.username.trim().toLowerCase() !== username.toLowerCase()) return;
        this.usernameTaken = response?.data?.available === false;
        this.usernameCheckError = response?.success !== true || typeof response?.data?.available !== 'boolean';
        this.usernameVerified = !this.usernameCheckError && !this.usernameTaken ? username.toLowerCase() : '';
        this.usernameChecking = false;
      },
      error: () => {
        if(this.username.trim().toLowerCase()!==username.toLowerCase())return;
        this.usernameChecking = false;
        this.usernameCheckError = true;
        this.usernameVerified = '';
      }
    });
  }

  onSubmit(): void {
    if (this.backendLoading || this.submitting || !this.username || !this.password || (this.registerMode && (this.usernameTaken || this.usernameChecking || this.usernameCheckError || this.usernameVerified !== this.username.trim().toLowerCase() || this.emailTaken || this.emailChecking || this.emailCheckError || this.emailVerified !== this.email.trim().toLowerCase() || !this.registrationValid))) return;
    if (this.registerMode) {
      this.onRegister();
      return;
    }
    this.onLogin();
  }

  private onLogin(): void {
    const username = this.username;
    const password = this.password;
    this.submitting = true;
    this.authError = '';
    this.authSuccess = '';

    localStorage.removeItem('investmentLabUsername');
    localStorage.removeItem('investmentLabRole');
    this.portfolioSelection.resetForLogin();

    this.apiService.login(username, password).subscribe({
      next: (response: any) => {
        localStorage.setItem('investmentLabUsername', String(response?.data?.username ?? username));
        localStorage.setItem('investmentLabRole', response?.data?.role === 'ADMIN' ? 'ADMIN' : 'GUEST');
        this.portfolioSelection.loadPortfolios();
        this.submitting = false;
        void this.router.navigateByUrl('/home');
      },
      error: () => {
        this.submitting = false;
        this.authError = 'Username o password non corretti.';
      }
    });
  }

  private onRegister(): void {
    this.submitting = true;
    this.authError = '';
    this.authSuccess = '';

    this.apiService.register(this.username, this.password, this.email.trim(), this.birthDate).subscribe({
      next: (response: any) => {
        this.submitting = false;
        this.username = String(response?.data?.username ?? this.username);
        this.password = '';
        this.registerMode = false;
        this.authSuccess = 'Registrazione completata. Ora puoi accedere.';
      },
      error: (error) => {
        this.submitting = false;
        if (error?.status === 409) {
          if (error?.error?.field === 'email') { this.emailTaken = true; this.authError = 'Email già utilizzata. Cambiala.'; return; }
          this.authError = 'Username già esistente. Scegline un altro.';
          return;
        }
        this.authError = error?.error?.error || 'Registrazione non riuscita.';
      }
    });
  }
}
