import { CommonModule } from '@angular/common';
import { Component, Input } from '@angular/core';
import { ChartTooltipComponent } from '../chart-tooltip/chart-tooltip.component';

export interface AssetDonutItem { label: string; value: number; weight: number; color: string; }

@Component({
  selector: 'app-asset-donut',
  standalone: true,
  imports: [CommonModule, ChartTooltipComponent],
  template: `
    <div class="composition">
      <div class="donut donut--interactive">
        <svg class="donut-svg" viewBox="0 0 100 100" (mouseleave)="leave()">
          <defs><filter [attr.id]="filterId" x="-60%" y="-60%" width="220%" height="220%">
            <feGaussianBlur in="SourceAlpha" stdDeviation="1.45" result="blur"/>
            <feOffset in="blur" dx="1.4" dy="2.3" result="offset"/>
            <feFlood flood-color="#000000" flood-opacity=".58" result="shadowColor"/>
            <feComposite in="shadowColor" in2="offset" operator="in" result="shadow"/>
            <feMerge><feMergeNode in="shadow"/><feMergeNode in="SourceGraphic"/></feMerge>
          </filter></defs>
          <circle class="donut-track" cx="50" cy="50" r="38" pathLength="100"/>
          <g class="donut-slices">
            <circle *ngFor="let item of items; let i=index" class="donut-slice" cx="50" cy="50" r="38" pathLength="100"
              [class.donut-slice--hidden]="hoverIndex===i"
              [class.donut-slice--dimmed]="hoverIndex!==null && hoverIndex!==i"
              [attr.stroke]="item.color" [attr.stroke-dasharray]="item.weight + ' ' + (100-item.weight)"
              [attr.stroke-dashoffset]="offset(i)" (mouseenter)="hover(i,$event)" (mousemove)="moveTooltip($event)"/>
          </g>
          <circle *ngIf="hoverIndex!==null && items[hoverIndex]" class="donut-slice donut-slice--lifted"
            cx="50" cy="50" r="38" pathLength="100"
            [attr.stroke]="items[hoverIndex].color"
            [attr.stroke-dasharray]="items[hoverIndex].weight + ' ' + (100-items[hoverIndex].weight)"
            [attr.stroke-dashoffset]="offset(hoverIndex)"
            [attr.transform]="sliceTransform(hoverIndex)" (mousemove)="moveTooltip($event)"/>
        </svg>
        <div class="donut-center"><strong>{{ centerText }}</strong><small *ngIf="centerCaption">{{ centerCaption }}</small></div>
      </div>
      <ul><li *ngFor="let item of items"><i [style.background]="item.color"></i><span [title]="item.label">{{ item.label }}</span></li></ul>
      <app-chart-tooltip *ngIf="tooltip.visible && hoverIndex!==null && items[hoverIndex]"
        class="composition-tooltip" [style.left.px]="tooltip.x" [style.top.px]="tooltip.y"
        [label]="items[hoverIndex].label"
        [value]="(items[hoverIndex].weight | number:'1.1-1':'it-IT') + '%'"/>
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
    .donut-slices{filter:drop-shadow(1.4px 2.4px 2.4px rgba(0,0,0,.38))}
    .donut-slice{cursor:pointer;stroke-linecap:butt;filter:brightness(1.035) saturate(1.07) drop-shadow(-.65px -.65px .45px rgba(255,255,255,.12));transition:opacity .16s ease,filter .18s ease}
    .donut-slice--dimmed{opacity:.96;filter:brightness(.99) saturate(1.02)}
    .donut-slice--hidden{opacity:0}
    .donut-slice--lifted{pointer-events:auto;stroke-linecap:butt;filter:brightness(1.13) saturate(1.12) drop-shadow(-1px -1px .7px rgba(255,255,255,.18));transition:transform .2s cubic-bezier(.2,.85,.2,1),filter .2s ease;transform-box:view-box;transform-origin:50px 50px}
    .donut-center{position:relative;z-index:2;width:82px;height:82px;border-radius:50%;background:linear-gradient(145deg,rgba(14,31,48,.98),rgba(5,14,24,.99));display:flex;flex-direction:column;align-items:center;justify-content:center;padding:0 6px;box-sizing:border-box;text-align:center;pointer-events:none;box-shadow:inset 2px 2px 6px rgba(115,183,235,.055),inset -3px -4px 9px rgba(0,0,0,.28),0 2px 7px rgba(0,0,0,.16)}
    .donut-center strong{font-size:.72rem;white-space:nowrap}
    .donut-center small{font-size:.48rem;color:#8ea3ba;line-height:1.15}
    .composition ul{list-style:none;padding:0;margin:0;flex:1;min-width:0}
    .composition li{display:grid;grid-template-columns:10px minmax(0,1fr);align-items:center;gap:6px;padding:4px 0;font-size:.62rem}
    .composition i{width:7px;height:7px;border-radius:50%}
    .composition li span{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
    .composition-tooltip{position:fixed;z-index:6000;pointer-events:none;transform:translate(10px,-100%);display:block}
    @media(max-width:480px){.composition{gap:9px}.donut{width:120px;height:120px}.donut-center{width:70px;height:70px}}
  `]
})
export class AssetDonutComponent {
  @Input() items: AssetDonutItem[] = [];
  @Input() centerText = '';
  @Input() centerCaption = '';
  private static sequence = 0;
  readonly filterId = 'assetDonutShadow' + ++AssetDonutComponent.sequence;
  hoverIndex: number | null = null;
  tooltip = { x: 0, y: 0, visible: false };
  offset(index: number): number { return -this.items.slice(0,index).reduce((sum,item)=>sum+item.weight,0); }
  sliceTransform(index: number): string {
    if (this.hoverIndex !== index) return 'translate(0 0)';
    const before = this.items.slice(0,index).reduce((sum,item)=>sum+item.weight,0);
    const radians = (before+(this.items[index]?.weight??0)/2)*3.6*Math.PI/180;
    return `translate(${(Math.cos(radians)*.45).toFixed(2)} ${(Math.sin(radians)*.45).toFixed(2)}) scale(1.035)`;
  }
  hover(index:number,event:MouseEvent):void { this.hoverIndex=index;this.moveTooltip(event); }
  moveTooltip(event:MouseEvent):void {this.tooltip={x:event.clientX+14,y:event.clientY-14,visible:true};}
  leave():void {this.hoverIndex=null;this.tooltip={...this.tooltip,visible:false};}
}
