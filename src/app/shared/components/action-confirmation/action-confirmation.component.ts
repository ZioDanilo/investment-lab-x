import { CommonModule } from '@angular/common';
import { Component, inject } from '@angular/core';
import { ActionConfirmationService } from '../../../core/services/action-confirmation.service';

@Component({
  selector: 'app-action-confirmation',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div *ngIf="confirmation.pending() as request" class="portfolio-confirm-overlay" (click)="confirmation.cancel()" (keydown.escape)="confirmation.cancel()" tabindex="-1">
      <section class="portfolio-confirm-dialog" role="dialog" aria-modal="true" aria-labelledby="action-confirm-title" (click)="$event.stopPropagation()">
        <h2 id="action-confirm-title">{{ request.title }}</h2>
        <div class="portfolio-confirm-actions">
          <button type="button" class="portfolio-confirm-button portfolio-confirm-button--cancel" (click)="confirmation.cancel()">No, non farlo</button>
          <button type="button" class="portfolio-confirm-button portfolio-confirm-button--confirm" (click)="confirmation.confirm()">{{ request.confirmLabel }}</button>
        </div>
      </section>
    </div>
  `,
  styleUrls: ['./action-confirmation.component.css']
})
export class ActionConfirmationComponent {
  readonly confirmation = inject(ActionConfirmationService);
}
