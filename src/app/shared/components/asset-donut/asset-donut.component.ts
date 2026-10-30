import { CommonModule } from '@angular/common';
import { Component, Input, OnDestroy } from '@angular/core';

export interface AssetDonutItem { label: string; value: number; weight: number; color: string; }

@Component({
  selector: 'app-asset-donut',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="composition" (mouseleave)="leave()">
      <div class="donut donut--interactive">
        <svg class="donut-svg" viewBox="0 0 100 100">
          <circle class="donut-track" cx="50" cy="50" r="38"/>
          <g class="donut-slices">
            <path *ngFor="let item of items; let i=index" class="donut-slice"
              [class.donut-slice--active]="hoverIndex===i"
              [class.donut-slice--dimmed]="hoverIndex!==null && hoverIndex!==i"
              [attr.stroke]="item.color" [attr.d]="slicePath(i)"
              (mouseenter)="hover(i,$event)" (mousemove)="moveTooltip($event)"/>
          </g>
        </svg>
        <div class="donut-center"><strong>{{ centerText }}</strong><small *ngIf="centerCaption">{{ centerCaption }}</small></div>
      </div>
      <ul><li *ngFor="let item of items; let i=index" (mouseenter)="hover(i,$event)" (mousemove)="moveTooltip($event)" (mouseleave)="leave()"><i [style.background]="item.color"></i><span [title]="item.label">{{ item.label }}</span></li></ul>

    </div>
  `,
  styles: [`
    :host{display:block;min-width:0}
    .composition{display:flex;align-items:center;gap:14px;padding-top:8px;min-width:0}
    .donut{width:142px;height:142px;border-radius:50%;display:grid;place-items:center;flex:0 0 auto}
    .donut--interactive{position:relative;background:none;overflow:visible}
    .donut-svg{position:absolute;inset:-10px;width:calc(100% + 20px);height:calc(100% + 20px);overflow:visible;transform:rotate(-90deg)}
    .donut-track,.donut-slice{fill:none;stroke-width:18}
    .donut-track{stroke:rgba(55,82,111,.34)}
    .donut-slices{filter:none}
    .donut-slice{cursor:pointer;stroke-linecap:butt;filter:none;transition:opacity .16s ease}
    .donut-slice--dimmed{opacity:.72}
    .donut-slice--active{opacity:1;stroke-width:18}
    
    .donut-center{position:relative;z-index:2;width:82px;height:82px;border-radius:50%;background:linear-gradient(145deg,rgba(14,31,48,.98),rgba(5,14,24,.99));display:flex;flex-direction:column;align-items:center;justify-content:center;padding:0 6px;box-sizing:border-box;text-align:center;pointer-events:none;box-shadow:inset 2px 2px 6px rgba(115,183,235,.055),inset -3px -4px 9px rgba(0,0,0,.28),0 2px 7px rgba(0,0,0,.16)}
    .donut-center strong{font-size:.72rem;white-space:nowrap}
    .donut-center small{font-size:.48rem;color:#8ea3ba;line-height:1.15}
    .composition ul{list-style:none;padding:0;margin:0;flex:1;min-width:0}
    .composition li{display:grid;grid-template-columns:10px minmax(0,1fr);align-items:center;gap:6px;padding:4px 0;font-size:.62rem}
    .composition i{width:7px;height:7px;border-radius:50%}
    .composition li span{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
    .composition-tooltip{position:fixed;z-index:2147483000;pointer-events:none;transform:translate(10px,-100%);display:block}
    @media(max-width:480px){.composition{gap:9px}.donut{width:120px;height:120px}.donut-center{width:70px;height:70px}}
  `]
})
export class AssetDonutComponent implements OnDestroy {
  @Input() items: AssetDonutItem[] = [];
  @Input() centerText = '';
  @Input() centerCaption = '';
  @Input() showCounts = false;
  private floatingTooltip: HTMLDivElement | null = null;
  private ensureTooltip(): HTMLDivElement {
    if (this.floatingTooltip) return this.floatingTooltip;
    const element = document.createElement('div');
    element.setAttribute('role', 'tooltip');
    Object.assign(element.style, {
      position: 'fixed', zIndex: '2147483647', pointerEvents: 'none',
      padding: '6px 9px', borderRadius: '6px',
      border: '1px solid rgba(135,176,214,.22)',
      background: 'rgba(9,16,24,.96)',
      boxShadow: '0 14px 30px rgba(0,0,0,.28)',
      color: '#edf7ff', fontSize: '13px', fontWeight: '700',
      lineHeight: '1.2', whiteSpace: 'nowrap'
    });
    document.body.appendChild(element);
    this.floatingTooltip = element;
    return element;
  }
  ngOnDestroy(): void { this.removeTooltip(); }
  private removeTooltip(): void {
    this.floatingTooltip?.remove();
    this.floatingTooltip = null;
  }
  hoverIndex: number | null = null;
  tooltip = { x: 0, y: 0, visible: false };
  // Each slice is its own explicit arc: no dash-array wraparound or overlap at 0/360 degrees.
  slicePath(index: number): string {
    const total = this.items.reduce((sum, item) => sum + Math.max(0, Number(item.value) || 0), 0);
    if (total <= 0 || index < 0 || index >= this.items.length) return '';
    const before = this.items.slice(0, index).reduce((sum, item) => sum + Math.max(0, Number(item.value) || 0), 0);
    const amount = Math.max(0, Number(this.items[index].value) || 0);
    if (amount <= 0) return '';
    const start = before / total * Math.PI * 2;
    const sweep = amount / total * Math.PI * 2;
    const point = (angle: number) => ({
      x: (50 + 38 * Math.cos(angle)).toFixed(6),
      y: (50 + 38 * Math.sin(angle)).toFixed(6)
    });
    const first = point(start);
    if (sweep >= Math.PI * 2 - 1e-8) {
      const middle = point(start + Math.PI);
      return `M ${first.x} ${first.y} A 38 38 0 0 1 ${middle.x} ${middle.y} A 38 38 0 0 1 ${first.x} ${first.y}`;
    }
    const last = point(start + sweep);
    return `M ${first.x} ${first.y} A 38 38 0 ${sweep > Math.PI ? 1 : 0} 1 ${last.x} ${last.y}`;
  }
  tooltipValue(item: AssetDonutItem): string {
    const total = this.items.reduce((sum, entry) => sum + (Number(entry.value) || 0), 0);
    const percentage = total > 0 ? (Number(item.value) || 0) / total * 100 : Number(item.weight) || 0;
    const percentText = percentage.toLocaleString('it-IT', {minimumFractionDigits: 1, maximumFractionDigits: 1});
    return this.showCounts ? `${percentText}% (${Number(item.value) || 0} ETF su ${total})` : `${percentText}%`;
  }
  hover(index:number,event:MouseEvent):void {
    this.hoverIndex=index;
    const item = this.items[index];
    if (!item) return;
    this.ensureTooltip().textContent = `${item.label}: ${this.tooltipValue(item)}`;
    this.moveTooltip(event);
  }
  moveTooltip(event:MouseEvent):void {
    const tooltip = this.floatingTooltip;
    if (!tooltip) return;
    const width = tooltip.offsetWidth;
    const height = tooltip.offsetHeight;
    const x = Math.max(8, Math.min(event.clientX + 14, window.innerWidth - width - 8));
    const y = Math.max(8, Math.min(event.clientY - height - 12, window.innerHeight - height - 8));
    tooltip.style.left = `${x}px`;
    tooltip.style.top = `${y}px`;
  }
  leave():void {this.hoverIndex=null;this.removeTooltip();}
}
