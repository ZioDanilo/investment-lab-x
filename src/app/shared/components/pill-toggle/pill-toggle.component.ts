import { Component, EventEmitter, Input, Output } from '@angular/core';

@Component({
  selector: 'app-pill-toggle',
  standalone: true,
  template: `<button type="button" class="pill-toggle" [class.pill-toggle--on]="checked"
    role="switch" [attr.aria-checked]="checked" [attr.aria-label]="ariaLabel"
    [disabled]="disabled" (click)="checkedChange.emit(!checked)">
    <span class="pill-toggle__thumb"></span>
  </button>`,
  styles: [`
    :host{display:inline-flex;flex-shrink:0}
    .pill-toggle{display:inline-flex;align-items:center;width:37px;height:18px;padding:2px;border:0;border-radius:99px;background:#646d78;box-sizing:border-box;cursor:pointer;transition:background .22s ease}
    .pill-toggle--on{background:#20a568}
    .pill-toggle__thumb{display:block;width:19px;height:14px;flex-shrink:0;border-radius:99px;background:linear-gradient(145deg,#fff,#d5dbe0);box-shadow:0 1px 3px rgba(0,0,0,.28);transform:translateX(0);transition:transform .22s ease}
    .pill-toggle--on .pill-toggle__thumb{transform:translateX(14px)}
    .pill-toggle:focus-visible{outline:2px solid #18d9f6;outline-offset:3px}
    .pill-toggle:disabled{opacity:.6;cursor:wait}
  `]
})
export class PillToggleComponent {
  @Input() checked = false;
  @Input() disabled = false;
  @Input() ariaLabel = 'Attiva o disattiva';
  @Output() checkedChange = new EventEmitter<boolean>();
}
