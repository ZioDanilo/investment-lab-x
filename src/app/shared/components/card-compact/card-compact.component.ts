import { CommonModule } from '@angular/common';
import { Component, EventEmitter, Input, Output } from '@angular/core';

@Component({
  selector: 'app-card-compact',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './card-compact.component.html',
  styleUrls: ['./card-compact.component.css']
})
export class CardCompactComponent {
  @Input() title = '';
  @Input() expanded = false;
  @Input() editTitle = 'Modifica';
  @Input() deleteTitle = 'Elimina';

  @Output() edit = new EventEmitter<void>();
  @Output() delete = new EventEmitter<void>();
  @Output() toggle = new EventEmitter<void>();

  onEdit(event: MouseEvent): void {
    event.stopPropagation();
    this.edit.emit();
  }

  onDelete(event: MouseEvent): void {
    event.stopPropagation();
    this.delete.emit();
  }

  onToggle(): void {
    this.toggle.emit();
  }
}