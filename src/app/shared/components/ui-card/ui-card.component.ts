import { Component, Input } from '@angular/core';
import { CommonModule } from '@angular/common';
@Component({selector:'app-ui-card',standalone:true,imports:[CommonModule],template:`
<article class="ui-card" [class.ui-card--compact]="compact"><header *ngIf="title" class="ui-card__header"><h3>{{title}}</h3><ng-content select="[cardHeader]"></ng-content></header><ng-content></ng-content></article>`,styles:[`
:host{display:block;min-width:0}.ui-card{min-width:0;border:1px solid rgba(77,125,181,.25);border-radius:14px;background:linear-gradient(180deg,rgba(13,27,45,.94),rgba(6,17,30,.98));box-shadow:0 10px 28px rgba(0,0,0,.18),inset 0 1px 0 rgba(255,255,255,.025);padding:10px 12px}.ui-card--compact{padding:6px 9px}.ui-card__header{display:flex;align-items:center;justify-content:space-between;margin-bottom:6px}.ui-card__header h3{margin:0;font-size:.92rem;color:#e9f3ff}
`]}) export class UiCardComponent{@Input() title='';@Input() compact=false;}