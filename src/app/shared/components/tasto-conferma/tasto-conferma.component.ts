import { Component, Input, Output, EventEmitter, signal } from '@angular/core';
import { CommonModule } from '@angular/common';

@Component({
  selector: 'app-tasto-conferma',
  standalone: true,
  imports: [CommonModule],
  template: `
    <button
      type="button"
      [class]="getButtonClass()"
      [disabled]="isDisabled() || isLoading()"
      (click)="onButtonClick()"
    >
      <span *ngIf="!isLoading()">{{ label }}</span>
      <span *ngIf="isLoading()" class="loading-text">{{ loadingText }}</span>
    </button>
  `,
  styles: [`
    .btn {
      padding: 0.62rem 1.2rem;
      border-radius: 12px;
      border: 1px solid transparent;
      font-size: 0.9rem;
      font-weight: 700;
      letter-spacing: 0.01em;
      cursor: pointer;
      transition: transform 180ms ease, box-shadow 180ms ease, background-color 180ms ease, border-color 180ms ease;
    }

    .btn:disabled {
      opacity: 0.55;
      cursor: not-allowed;
    }

    .btn:not(:disabled):hover {
      transform: translateY(-1px);
    }

    .btn:not(:disabled):active {
      transform: translateY(0);
    }

    .loading-text {
      display: inline-block;
    }

    .btn-primary {
      background: linear-gradient(135deg, var(--blue-primary) 0%, var(--blue-secondary) 100%);
      color: #071018;
      border-color: rgba(23, 200, 255, 0.5);
      box-shadow: 0 8px 20px rgba(23, 200, 255, 0.24);
    }

    .btn-primary:not(:disabled):hover {
      box-shadow: 0 12px 24px rgba(23, 200, 255, 0.34);
    }

    .btn-success {
      background: linear-gradient(135deg, var(--green) 0%, #58c62b 100%);
      color: #07120a;
      border-color: rgba(111, 213, 59, 0.45);
    }

    .btn-danger {
      background: linear-gradient(135deg, var(--red) 0%, #f14a4a 100%);
      color: #220c0c;
      border-color: rgba(255, 93, 93, 0.45);
    }

    .btn-warning {
      background: linear-gradient(135deg, var(--gold) 0%, #db9f00 100%);
      color: #211807;
      border-color: rgba(244, 180, 0, 0.5);
    }

    .btn-secondary {
      background: rgba(255, 255, 255, 0.03);
      color: var(--text);
      border-color: rgba(23, 200, 255, 0.35);
      box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.04);
    }

    .btn-secondary:not(:disabled):hover {
      background: rgba(23, 200, 255, 0.12);
    }

    .btn-large {
      padding: 0.82rem 1.5rem;
      font-size: 0.95rem;
    }

    .btn-small {
      padding: 0.45rem 0.9rem;
      font-size: 0.8rem;
    }
  `]
})
export class TastoConfermaComponent {
  /**
   * Testo da mostrare nel bottone
   */
  @Input() label: string = 'Conferma';

  /**
   * Testo da mostrare durante il caricamento
   */
  @Input() loadingText: string = 'Elaborazione...';

  /**
   * Tipo di bottone: 'primary' | 'success' | 'danger' | 'warning' | 'secondary'
   */
  @Input() variant: 'primary' | 'success' | 'danger' | 'warning' | 'secondary' = 'primary';

  /**
   * Dimensione bottone: 'small' | 'medium' | 'large'
   */
  @Input() size: 'small' | 'medium' | 'large' = 'medium';

  /**
   * Se il bottone è disabilitato
   */
  @Input() set disabled(value: boolean) {
    this.isDisabled.set(value);
  }

  /**
   * Se il bottone è in stato di caricamento
   */
  @Input() set loading(value: boolean) {
    this.isLoading.set(value);
  }

  /**
   * Callback quando il bottone è cliccato
   * L'onConfirm deve ritornare una Promise che risolve quando l'azione è completata
   */
  @Input() onConfirm: (() => Promise<void>) | null = null;

  /**
   * Event emesso quando la conferma è completata con successo
   */
  @Output() confirmed = new EventEmitter<void>();

  /**
   * Event emesso in caso di errore
   */
  @Output() error = new EventEmitter<Error>();

  // Signal per il tracking dello stato interno
  isDisabled = signal(false);
  isLoading = signal(false);

  /**
   * Handler del click del bottone
   * Chiama onConfirm se fornito, gestisce il loading state e emette gli event
   */
  async onButtonClick(): Promise<void> {
    if (this.isDisabled() || this.isLoading()) {
      return;
    }

    try {
      this.isLoading.set(true);

      if (this.onConfirm) {
        await this.onConfirm();
      }

      this.confirmed.emit();
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      this.error.emit(error);
    } finally {
      this.isLoading.set(false);
    }
  }

  /**
   * Genera le classi CSS per il bottone
   */
  getButtonClass(): string {
    const classes = ['btn', `btn-${this.variant}`];
    
    if (this.size === 'large') {
      classes.push('btn-large');
    } else if (this.size === 'small') {
      classes.push('btn-small');
    }

    return classes.join(' ');
  }
}
