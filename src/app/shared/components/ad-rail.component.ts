import { Component } from '@angular/core';
import { AdsenseSlotComponent } from './adsense-slot.component';

/**
 * Shared three-slot advertising rail for public login and authenticated Home.
 * Its host is positioned relative to the content area immediately below
 * each page's navbar; the sidebar's independent advertisement is untouched.
 */
@Component({
  selector: 'app-ad-rail',
  standalone: true,
  imports: [AdsenseSlotComponent],
  template: `
    <app-adsense-slot slot="7612479205" />
    <app-adsense-slot slot="9075850092" />
    <app-adsense-slot slot="4538014291" />
  `,
  styles: [`
    :host {
      display: grid;
      grid-template-rows: 174px 174px 180px;
      gap: 12px;
      width: 150px;
    }
    :host > app-adsense-slot {
      display: block;
      box-sizing: border-box;
      width: 100%;
      height: 100%;
      min-height: 0;
      border: 1px dashed rgba(125, 166, 210, .45);
      border-radius: 12px;
      background: linear-gradient(145deg, rgba(24,45,68,.65), rgba(9,17,29,.86));
      overflow: hidden;
    }
    @media (max-width: 1180px) {
      :host {
        width: min(320px, calc(100% - 24px));
        display: flex;
        flex-direction: column;
      }
      :host > app-adsense-slot { min-height: 90px; height: 90px; }
    }
  `]
})
export class AdRailComponent {}
