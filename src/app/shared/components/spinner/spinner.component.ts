import { CommonModule } from '@angular/common';
import { Component, Input } from '@angular/core';

@Component({
  selector: 'app-spinner',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './spinner.component.html',
  styleUrls: ['./spinner.component.css']
})
export class SpinnerComponent {
  @Input() label = '';
  @Input() ariaLabel = 'Caricamento in corso';
  @Input() size: 'sm' | 'md' | 'lg' = 'md';

  hostClass(): string {
    return `shared-spinner shared-spinner--${this.size}`;
  }
}
