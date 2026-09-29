import { Component, Input } from '@angular/core';import { CommonModule } from '@angular/common';
export interface ChartLegendItem{label:string;color:string}
@Component({selector:'app-chart-legend',standalone:true,imports:[CommonModule],template:`<div class="legend" [class.vertical]="vertical"><span *ngFor="let i of items"><i [style.background]="i.color"></i>{{i.label}}</span></div>`,styles:[`
.legend{display:flex;gap:10px}.legend.vertical{flex-direction:column;gap:5px}.legend span{display:flex;align-items:center;gap:5px;color:#a9bad0;font-size:10px;font-weight:700}.legend i{display:inline-block;width:16px;height:2px}
`]}) export class ChartLegendComponent{@Input() items:ChartLegendItem[]=[];@Input() vertical=false;}