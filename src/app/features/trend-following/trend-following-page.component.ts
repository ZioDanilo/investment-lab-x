import { Component, effect, inject, OnDestroy, TemplateRef, ViewChild, untracked } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Subscription } from 'rxjs';
import { ApiService } from '../../core/api/api.service';
import { QuotationService } from '../../core/services/quotation.service';
import { PortfolioSelectionService } from '../../core/services/portfolio-selection.service';

interface Etf { isin: string; label: string; search: string }
interface Criterion {
  strategyKey: string; isin: string; benchmarkIsin: string; thirdIsin: string; sixValues: (number|null)[]; signal: 'buy' | 'sell';
  price: number | null; average: number | null; benchmarkReturn: number | null;
  loading: boolean; benchmarkLoading: boolean; error: string;
  benchmarkSearch: string; searchOpen: boolean; version: number;
  subscription?: Subscription; benchmarkSubscription?: Subscription;
}
const STRATEGIES = [
  { key: 'sma-200', label: 'Media mobile 200 giorni' },
  { key: 'ts-momentum-12m', label: 'Time Series 12 mesi' },
  { key: 'dual-sma-50-200', label: 'Doppia media mobile 50/200' },
  { key: 'momentum-world-xeon', label: 'A3Stati' },
  { key: 'momentum-xeon-fast-reentry', label: 'Momentum → XEON con rientro rapido' },
  { key: 'trend-volatility-targeting', label: 'Trend Following + Volatility Targeting' },
  { key: 'momentum-world-xeon-volatility-targeting', label: 'Momentum → World → XEON + Volatility Targeting' }
];
@Component({
  selector: 'app-trend-following-page',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    <ng-template #draftEditor><div *ngIf="draft" class="criteria-list draft-list">
        <article class="criterion criterion--draft">
          <select class="signal-select" [(ngModel)]="draft.signal" aria-label="Tipo di segnale"><option value="sell">Segnale di vendita</option><option value="buy">Segnale di acquisto</option></select>
          <select class="strategy-select" [ngModel]="draft.strategyKey" (ngModelChange)="changeStrategy(-1,$event)" [attr.aria-label]="'Strategia criterio '+'nuova'">
            <option value="">Seleziona strategia</option>
            <option *ngFor="let strategy of strategies" [value]="strategy.key">{{strategy.label}}</option>
          </select>
          <div class="etf-slots" [class.etf-slots--compare]="draft.strategyKey === 'ts-momentum-12m'" [class.etf-slots--three]="draft.strategyKey === 'momentum-world-xeon'">
            <div class="primary-slot">
          <select class="etf-select" [ngModel]="draft.isin" (ngModelChange)="selectEtf(-1,$event)"
            [disabled]="loadingPortfolio || !etfs.length" [attr.aria-label]="'ETF criterio '+'nuova'">
            <option value="">Seleziona ETF</option>
            <option *ngFor="let etf of availableEtfs(draft)" [value]="etf.isin">{{etf.label}}</option>
          </select>
            </div>
          <div class="secondary-slot" *ngIf="draft.strategyKey === 'momentum-world-xeon'">
            <span class="compare-sign">&gt;</span>
            <select class="etf-select" [ngModel]="draft.benchmarkIsin" (ngModelChange)="draft.benchmarkIsin=$event" aria-label="Secondo ETF"><option value="">Secondo ETF</option><option *ngFor="let etf of allEtfs" [value]="etf.isin">{{etf.label}}</option></select>
          </div>
          <div class="third-slot" *ngIf="draft.strategyKey === 'momentum-world-xeon'">
            <span class="compare-sign">&gt;</span>
            <select class="etf-select" [ngModel]="draft.thirdIsin" (ngModelChange)="draft.thirdIsin=$event" aria-label="Terzo ETF"><option value="">Terzo ETF</option><option *ngFor="let etf of allEtfs" [value]="etf.isin">{{etf.label}}</option></select>
          </div>
          <div class="secondary-slot"><ng-container *ngIf="draft.strategyKey === 'ts-momentum-12m'">
            <span class="compare-sign">&gt;</span>
            <div class="benchmark-search">
              <input type="text" [value]="draft.benchmarkSearch" (input)="filterBenchmark(-1,$any($event.target).value)"
                (focus)="draft.searchOpen=true" (blur)="closeBenchmark(-1)"
                placeholder="Confronto: ETF o 0%" [attr.aria-label]="'ETF confronto '+'nuova'" autocomplete="off">
              <button *ngIf="draft.benchmarkIsin || draft.benchmarkSearch" class="clear" type="button" (mousedown)="$event.preventDefault()" (click)="selectBenchmark(-1,'')">×</button>
              <div *ngIf="draft.searchOpen" class="benchmark-options">
                <button type="button" (mousedown)="$event.preventDefault();selectBenchmark(-1,'')">Nessun ETF — 0%</button>
                <button *ngFor="let etf of filteredBenchmarks(draft)" type="button" (mousedown)="$event.preventDefault();selectBenchmark(-1,etf.isin)">{{etf.label}}</button>
              </div>
            </div>
          </ng-container></div>
          </div>
          <button type="button" class="draft-confirm" (click)="confirmDraft()" [disabled]="!draft.strategyKey || !draft.isin || (draft.strategyKey === 'momentum-world-xeon' && (!draft.benchmarkIsin || !draft.thirdIsin))" title="Conferma strategia" aria-label="Conferma strategia">✓</button><button type="button" class="remove icon-action-button icon-action-button--danger" (click)="cancelDraft()" title="Elimina strategia" [attr.aria-label]="'Elimina strategia '+'nuova'"><span class="icon-action-button__glyph">✕</span></button>
          <span *ngIf="draft.error" class="row-error">{{draft.error}}</span>
        </article>
      </div>
    </ng-template>
    <section class="trend-page">
      <div class="signal-group" *ngFor="let signal of signalGroups"><h3>{{signal === 'sell' ? 'Segnali di vendita' : 'Segnali di acquisto'}}</h3><div class="criteria-list" [class.criteria-list--settling]="settlingDrag" (dragover)="onListDragOver($event,signal)" (drop)="onListDrop($event,signal)">
        <article *ngFor="let row of rowsForSignal(signal); trackBy:trackRow" class="criterion" draggable="true" [class.is-dragging]="draggedRow===row" [class.shift-up]="dragShiftFor(row,signal)==='up'" [class.shift-down]="dragShiftFor(row,signal)==='down'" (dragstart)="onRowDragStart(row,$event)" (drag)="onRowDrag($event)" (dragend)="onRowDragEnd()">
          <span class="criterion-action-label" [class.criterion-action-label--active]="(signal === 'sell' && isNegative(row)) || (signal === 'buy' && isPositive(row))"><svg *ngIf="(signal === 'sell' && isNegative(row)) || (signal === 'buy' && isPositive(row))" class="signal-warning-icon" viewBox="0 0 32 30" role="img" [attr.aria-label]="signal === 'sell' ? 'Segnale di vendita' : 'Segnale di acquisto'"><path d="M16 2.5 L30 27.5 H2 Z" fill="#ffd447" stroke="#ffd447" stroke-width="2" stroke-linejoin="round"/><path d="M16 10 V19" stroke="#141414" stroke-width="3.4" stroke-linecap="round"/><circle cx="16" cy="24" r="1.9" fill="#141414"/></svg></span>
          <span class="saved-strategy-text" [title]="strategyLabel(row.strategyKey)">{{strategyLabel(row.strategyKey)}}</span>
          <div class="etf-slots saved-etf-slots" [class.etf-slots--three]="row.strategyKey === 'momentum-world-xeon'">
            <div class="primary-slot">
              <span class="saved-etf-text" [title]="etfLabel(row.isin)">{{etfLabel(row.isin)}}</span>
            </div>
            <div class="secondary-slot" *ngIf="row.strategyKey === 'momentum-world-xeon'"><span class="compare-sign">&gt;</span><span class="saved-etf-text" [title]="etfLabel(row.benchmarkIsin)">{{etfLabel(row.benchmarkIsin)}}</span></div>
          <div class="third-slot" *ngIf="row.strategyKey === 'momentum-world-xeon'"><span class="compare-sign">&gt;</span><span class="saved-etf-text" [title]="etfLabel(row.thirdIsin)">{{etfLabel(row.thirdIsin)}}</span></div>
          <div class="secondary-slot" *ngIf="row.strategyKey === 'ts-momentum-12m'">
              <span class="compare-sign">&gt;</span>
              <span class="saved-etf-text" [title]="row.benchmarkIsin ? etfLabel(row.benchmarkIsin) : '0%'">{{row.benchmarkIsin ? etfLabel(row.benchmarkIsin) : '0%'}}</span>
            </div>
          </div>
          <ng-container *ngIf="row.strategyKey === 'momentum-world-xeon'">
            <div class="metric metric--six" *ngFor="let value of row.sixValues; let i=index" [class.outcome--signal]="i>=4 && ((signal==='sell' && value!==null && value<0) || (signal==='buy' && value!==null && value>0))" [title]="threeStateTitles[i]">{{row.loading?'—':formatRatio(value)}}</div>
          </ng-container>
          <div *ngIf="row.strategyKey !== 'momentum-world-xeon'" class="metric" [title]="row.strategyKey === 'dual-sma-50-200' ? 'Media mobile 50 giorni' : row.strategyKey === 'ts-momentum-12m' ? 'Rendimento 12 mesi ETF' : 'Prezzo'">
            {{row.loading ? '—' : row.strategyKey === 'ts-momentum-12m' ? formatPercent(annualReturn(row)) : formatPrice(row.price)}}
          </div>
          <div *ngIf="row.strategyKey !== 'momentum-world-xeon'" class="metric" [title]="row.strategyKey === 'ts-momentum-12m' ? 'Rendimento 12 mesi confronto' : 'Media mobile 200 giorni'">
            {{row.loading || row.benchmarkLoading ? '—' : row.strategyKey === 'ts-momentum-12m' ? formatPercent(row.benchmarkIsin ? row.benchmarkReturn : 0) : formatPrice(row.average)}}
          </div>
          <div *ngIf="row.strategyKey !== 'momentum-world-xeon'" class="metric outcome" [class.outcome--signal]="(signal === 'sell' && isNegative(row)) || (signal === 'buy' && isPositive(row))" [title]="row.error || 'Differenza'">
            {{row.strategyKey === 'ts-momentum-12m' ? comparisonText(row) : differenceText(row)}}
          </div>
          <button type="button" class="remove icon-action-button icon-action-button--danger" (click)="requestRemoveCriterion(row)" title="Elimina strategia" [attr.aria-label]="'Elimina strategia '+(criteria.indexOf(row)+1)"><span class="icon-action-button__glyph">✕</span></button>
          <span *ngIf="row.error" class="row-error">{{row.error}}</span>
        </article>
<p *ngIf="!rowsForSignal(signal).length" class="empty-signal">Nessuna strategia inserita.</p></div></div>
      <div *ngIf="pendingRemoveRow" class="delete-confirm-overlay" (click)="cancelRemoveCriterion()">
        <section class="delete-confirm-dialog" role="dialog" aria-modal="true" aria-labelledby="delete-strategy-title" (click)="$event.stopPropagation()">
          <h2 id="delete-strategy-title">Vuoi eliminare questa strategia di trend following?</h2>
          <div class="delete-confirm-actions">
            <button type="button" class="delete-confirm-button delete-confirm-button--keep" (click)="cancelRemoveCriterion()">✔ No, non farlo</button>
            <button type="button" class="delete-confirm-button delete-confirm-button--delete" (click)="confirmRemoveCriterion()">✕ Sì, elimina</button>
          </div>
        </section>
      </div>
      <article class="suggestions">
        <h3><span class="material-symbols-rounded icon">emoji_objects</span>Suggerimenti</h3>
        <p>Nessun suggerimento disponibile.</p>
      </article>
    </section>
  `,
  styles: [`
    .trend-page{display:flex;flex-direction:column;min-height:calc(100dvh - 190px);gap:12px}

    .draft-list{padding:4px 8px;min-height:0;width:100%;box-sizing:border-box}
    .draft-list .criterion{padding:4px 2px}
    .draft-list .signal-select{flex:0 0 205px}
    .draft-list .strategy-select{flex:0 0 200px}
    .draft-list .etf-slots{flex:1 1 360px;min-width:260px;overflow:visible}
    .etf-slots--three{grid-template-columns:repeat(3,minmax(0,1fr))}
    .third-slot{min-width:0;display:flex;align-items:center;gap:6px;min-height:39px}
    .third-slot .etf-select,.secondary-slot .etf-select{width:100%;min-width:0}
    .draft-list .etf-slots--three{grid-template-columns:repeat(3,minmax(0,1fr))}
    .draft-list .etf-slots--compare{grid-template-columns:minmax(0,1fr) minmax(0,1fr)}
    .draft-list .etf-slots--compare .secondary-slot{display:flex;min-width:0}
    .draft-list .etf-slots--compare .benchmark-search{min-width:0}
    .draft-list .metric{flex:0 1 76px;min-width:60px}
    .draft-list .outcome{flex:0 1 110px;min-width:85px}
    .signal-group{display:flex;flex-direction:column;gap:8px}
    .signal-group h3,.draft-list h3{margin:0 0 3px;color:#e6f1fc;font-size:14px}
    .empty-signal{margin:0;padding:8px;color:#8ca4bb;font-size:13px}
    .signal-select{flex:0 0 175px}
    .draft-confirm{flex:0 0 32px;width:32px;height:32px;border:0;background:transparent;color:#48d1a3;cursor:pointer;font-size:22px}
    .draft-confirm:disabled{opacity:.35;cursor:not-allowed}
    .criteria-list{display:flex;flex-direction:column;gap:8px;padding:12px;border:1px solid rgba(85,128,173,.48);border-radius:15px;background:rgba(7,17,30,.92);box-shadow:0 6px 22px rgba(0,0,0,.14);min-height:68px;box-sizing:border-box}
    .criterion{display:flex;align-items:center;gap:8px;padding:9px 12px;border:0;border-radius:0;background:transparent;min-width:0;flex-wrap:wrap;box-sizing:border-box}
    .criterion[draggable="true"]{cursor:grab;transition:transform 190ms ease}
    .criterion.is-dragging{opacity:0}
    .criterion.shift-up{transform:translateY(calc(-100% - 8px))}
    .criterion.shift-down{transform:translateY(calc(100% + 8px))}
    .criteria-list--settling .criterion{transition:none!important}
    .criterion-status{flex:0 0 23px;font-size:23px;line-height:1;color:#b9c6d8;text-align:center}
    .criterion-status--success{color:#48d1a3}
    .criterion-status--failure{color:#f07181}
    .criterion-action-label{flex:0 0 32px;width:32px;display:flex;align-items:center;justify-content:center;line-height:1}
    .signal-warning-icon{width:24px;height:23px;display:block;flex:none}
    select,.benchmark-search input{height:39px;box-sizing:border-box;background:var(--surface-elevated);color:var(--text);border:1px solid var(--border);border-radius:7px;padding:0 9px;min-width:0;font:inherit}
    .saved-strategy-text{flex:0 1 21%;max-width:280px;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--text-secondary);font:inherit}
    .saved-etf-slots .saved-etf-text{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--text-secondary);font:inherit}
    .saved-etf-slots .primary-slot .saved-etf-text{width:100%}
    .strategy-select{flex:0 1 21%;max-width:280px}
    .etf-slots{flex:1 1 38%;min-width:260px;display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:8px;align-items:center}
    .primary-slot,.secondary-slot{min-width:0;display:flex;align-items:center;gap:6px;min-height:39px}
    .primary-slot .etf-select{width:100%;min-width:0}
    .secondary-slot .benchmark-search{flex:1 1 auto;min-width:0}
    .criterion:not(.criterion--draft) .etf-select:disabled,.criterion:not(.criterion--draft) .benchmark-search input[readonly]{background:var(--surface);color:var(--text-secondary);opacity:1;cursor:default}
    .strategy-select:disabled{background:var(--surface);color:var(--text-secondary);border-color:var(--border);opacity:1;cursor:not-allowed}.etf-select{flex:1 1 18%;min-width:130px}
    .benchmark-search{flex:1 1 15%;min-width:120px;position:relative;z-index:3}.benchmark-search input{width:100%;padding-right:26px}
    .compare-sign{font-weight:700;font-size:19px}.clear{position:absolute;right:5px;top:6px;background:transparent;border:0;color:white;font-size:20px;cursor:pointer}
    .benchmark-options{position:absolute;z-index:50;top:42px;left:0;right:0;max-height:240px;overflow:auto;background:var(--surface-elevated);border:1px solid var(--border);border-radius:8px}
    .benchmark-options button{display:block;width:100%;text-align:left;color:white;background:transparent;border:0;padding:9px;cursor:pointer}
    .benchmark-options button:hover{background:var(--surface)}
    .metric{flex:0 1 104px;min-width:80px;min-height:39px;display:flex;align-items:center;justify-content:center;padding:0 6px;box-sizing:border-box;border:1px solid rgba(115,150,190,.34);border-radius:7px;background:rgba(30,51,80,.62);font-weight:600;font-size:13px;white-space:nowrap}
    .metric--six{flex:1 1 0;min-width:0;padding:0 3px;font-size:12px}
    .metric--six.outcome--signal{border:3px solid #ffd447}
    .criterion:has(.metric--six) .saved-strategy-text{flex:0 0 110px}
    .criterion:has(.metric--six) .saved-etf-slots{flex:1 1 28%;min-width:200px}
    .outcome{flex:1 1 155px;min-width:130px}.metric,.outcome{color:#f4f7fc}
    .outcome.outcome--positive{border-color:#48d1a3}
    .outcome.outcome--negative{border-color:#f07181}
    .criterion .outcome.outcome--signal{border:3px solid #ffd447}
    .remove{flex:0 0 32px;width:32px;height:32px;padding:0}
    .delete-confirm-overlay{position:fixed;inset:0;z-index:5200;display:grid;place-items:center;padding:20px;background:rgba(2,7,13,.68);backdrop-filter:blur(4px)}
    .delete-confirm-dialog{width:min(390px,calc(100vw - 32px));padding:20px;border:1px solid rgba(122,176,224,.26);border-radius:14px;background:rgba(9,16,24,.97);box-shadow:0 22px 60px rgba(0,0,0,.48)}
    .delete-confirm-dialog h2{margin:0 0 18px;text-align:center;color:#edf5ff;font-size:1rem;line-height:1.35}
    .delete-confirm-actions{display:grid;grid-template-columns:1fr 1fr;gap:10px}
    .delete-confirm-button{height:38px;border-radius:8px;font:inherit;font-size:.76rem;font-weight:800;cursor:pointer;background:rgba(9,16,24,.86)}
    .delete-confirm-button--keep{border:1px solid rgba(37,230,177,.72);color:#69f1c9}
    .delete-confirm-button--keep:hover{background:rgba(19,103,79,.24)}
    .delete-confirm-button--delete{border:1px solid rgba(255,83,102,.72);color:#ff657d}
    .delete-confirm-button--delete:hover{background:rgba(116,25,36,.25)}
    .row-error{flex-basis:100%;color:#ff939a;font-size:12px}.error{color:#ff939a}.hint{color:#a9bad2}
    .suggestions{margin-top:auto;padding:12px 18px;border:1px solid rgba(77,132,187,.42);border-radius:14px;background:rgba(7,18,31,.94)}
    .suggestions h3{display:flex;align-items:center;gap:9px;margin:0 0 6px;font-size:16px}.suggestions p{margin:0;color:#a9bad2;font-size:13px}
    .icon{color:#ffe34f;font-size:30px}
    @media(max-width:950px){.criterion{gap:6px}.strategy-select{flex:1 1 40%;max-width:none}.etf-select{flex:1 1 40%}.metric{flex:1 1 25%}.outcome{flex:1 1 35%}}
  `]
})
export class TrendFollowingPageComponent implements OnDestroy {
  readonly portfolioSelection=inject(PortfolioSelectionService);
  private readonly api=inject(ApiService);
  private readonly quotations=inject(QuotationService);
  readonly strategies=STRATEGIES;
  readonly threeStateTitles=['Rapporto ETF 1 / ETF 2','Media mobile 100 giorni rapporto 1/2','Rapporto ETF 2 / ETF 3','Media mobile 100 giorni rapporto 2/3','Differenza rapporto 1/2','Differenza rapporto 2/3'];
  get headerActionLabel():string{return this.draft ? '' : 'AGGIUNGI STRATEGIA'}
  readonly headerActionIcon='add';
  get headerActionDisabled():boolean{return !!this.draft || !this.currentPortfolioId || this.loadingPortfolio || this.loadingSettings || this.muGenerating}
  get headerActionRunning():boolean{return this.muGenerating}
  get headerActionProgress():number{return this.muGenerating?Math.max(1,this.muProgress):0}
  muGenerating=false;muProgress=0;
  setMarketUniverseGenerationStatus(running:boolean,progress:number):void{this.muGenerating=running;this.muProgress=progress}
  runHeaderAction():void{this.addCriterion()}
  @ViewChild('draftEditor') draftEditorTemplate?:TemplateRef<unknown>;
  readonly criteria:Criterion[]=[];
  readonly signalGroups:('sell'|'buy')[]=['sell','buy'];
  draft:Criterion|null=null;
  rowsForSignal(signal:'sell'|'buy'):Criterion[]{return this.criteria.filter(row=>row.signal===signal)}
  private rowAt(i:number):Criterion|null{return i===-1?this.draft:(this.criteria[i]??null)}
  cancelDraft():void{if(this.draft)this.clearRequests(this.draft);this.draft=null}
  confirmDraft():void{const row=this.draft;if(!row||!row.strategyKey||!row.isin)return;this.draft=null;row.searchOpen=false;this.criteria.push(row);if(row.strategyKey==='momentum-world-xeon')this.loadThreeStates(row);else{if(this.isImplemented(row.strategyKey))this.loadQuote(row);if(row.benchmarkIsin)this.loadRestoredBenchmark(row)}this.queueSave()}
  etfs:Etf[]=[];allEtfs:Etf[]=[];
  loadingPortfolio=false;loadingSettings=false;saveError='';portfolioMessage='';
  private currentPortfolioId:string|null=null;
  private refreshVersion=-1;
  private portfolioSub?:Subscription;private catalogSub?:Subscription;private settingsSub?:Subscription;private saveSub?:Subscription;
  private saveQueued=false;private saving=false;private loadVersion=0;
  constructor(){
    effect(()=>{
      const selected=this.portfolioSelection.selectedPortfolio();
      const version=this.portfolioSelection.refreshVersion();
      if(selected?.id!==this.currentPortfolioId||version!==this.refreshVersion){
        this.currentPortfolioId=selected?.id??null;this.refreshVersion=version;
        untracked(()=>this.loadPortfolio());
      }
    });
  }

  draggedRow:Criterion|null=null;
  insertRowIndex:number|null=null;
  settlingDrag=false;
  private dragOffset={x:0,y:0};
  private dragPreview:HTMLElement|null=null;

  onRowDragStart(row:Criterion,event:DragEvent):void{
    const source=event.currentTarget as HTMLElement|null;
    if(!source||!event.dataTransfer)return;
    this.draggedRow=row;
    this.insertRowIndex=null;
    const rect=source.getBoundingClientRect();
    this.dragOffset={x:event.clientX-rect.left,y:event.clientY-rect.top};
    this.dragPreview?.remove();
    const preview=source.cloneNode(true) as HTMLElement;
    // cloneNode does not preserve the live selected state of native selects
    // (or the current value of text inputs). Mirror it into the floating row.
    const originalSelects=source.querySelectorAll<HTMLSelectElement>('select');
    const previewSelects=preview.querySelectorAll<HTMLSelectElement>('select');
    originalSelects.forEach((select,index)=>{
      const copy=previewSelects.item(index);
      if(!copy)return;
      copy.value=select.value;
      Array.from(copy.options).forEach(option=>{option.selected=option.value===select.value});
    });
    const originalInputs=source.querySelectorAll<HTMLInputElement>('input');
    const previewInputs=preview.querySelectorAll<HTMLInputElement>('input');
    originalInputs.forEach((input,index)=>{
      const copy=previewInputs.item(index);
      if(copy)copy.value=input.value;
    });
    preview.classList.remove('is-dragging','shift-up','shift-down');
    preview.style.cssText+=';position:fixed;left:'+rect.left+'px;top:'+rect.top+'px;width:'+rect.width+'px;height:'+rect.height+'px;box-sizing:border-box;opacity:1!important;visibility:visible!important;transform:none!important;transition:none!important;background:transparent!important;box-shadow:none!important;border:0!important;z-index:2147483647;pointer-events:none;';
    document.body.appendChild(preview);
    this.dragPreview=preview;
    event.dataTransfer.effectAllowed='move';
    event.dataTransfer.setData('text/plain','strategy-reorder');
    const blank=document.createElement('canvas');blank.width=1;blank.height=1;
    event.dataTransfer.setDragImage(blank,0,0);
  }
  onRowDrag(event:DragEvent):void{
    if(!this.draggedRow||!this.dragPreview||(event.clientX===0&&event.clientY===0))return;
    this.dragPreview.style.left=(event.clientX-this.dragOffset.x)+'px';
    this.dragPreview.style.top=(event.clientY-this.dragOffset.y)+'px';
  }
  onListDragOver(event:DragEvent,signal:'buy'|'sell'):void{
    if(!this.draggedRow||this.draggedRow.signal!==signal)return;
    event.preventDefault();
    if(event.dataTransfer)event.dataTransfer.dropEffect='move';
    const container=event.currentTarget as HTMLElement;
    const rows=Array.from(container.querySelectorAll<HTMLElement>('.criterion'));
    if(!rows.length)return;
    const first=rows[0].getBoundingClientRect();
    const stride=rows.length>1?Math.max(1,rows[1].offsetTop-rows[0].offsetTop):rows[0].offsetHeight+8;
    this.insertRowIndex=Math.max(0,Math.min(rows.length,Math.floor((event.clientY-first.top+stride/2)/stride)));
  }
  dragShiftFor(row:Criterion,signal:'buy'|'sell'):'up'|'down'|null{
    if(!this.draggedRow||this.draggedRow.signal!==signal||this.insertRowIndex===null)return null;
    const rows=this.rowsForSignal(signal);
    const from=rows.indexOf(this.draggedRow),index=rows.indexOf(row);
    if(from<0||index<0)return null;
    const to=Math.max(0,Math.min(rows.length-1,this.insertRowIndex-(from<this.insertRowIndex?1:0)));
    if(to>from&&index>from&&index<=to)return 'up';
    if(to<from&&index>=to&&index<from)return 'down';
    return null;
  }
  onListDrop(event:DragEvent,signal:'buy'|'sell'):void{
    if(!this.draggedRow||this.draggedRow.signal!==signal)return;
    event.preventDefault();event.stopPropagation();
    const rows=this.rowsForSignal(signal);
    const from=rows.indexOf(this.draggedRow),raw=this.insertRowIndex;
    this.settlingDrag=true;
    if(from>=0&&raw!==null){
      const to=Math.max(0,Math.min(rows.length-1,raw-(from<raw?1:0)));
      if(from!==to){
        rows.splice(from,1);
        rows.splice(to,0,this.draggedRow);
        const sells=signal==='sell'?rows:this.rowsForSignal('sell');
        const buys=signal==='buy'?rows:this.rowsForSignal('buy');
        this.criteria.splice(0,this.criteria.length,...sells,...buys);
        this.queueSave();
      }
    }
    this.finishRowDrag();
    requestAnimationFrame(()=>requestAnimationFrame(()=>{this.settlingDrag=false}));
  }
  onRowDragEnd():void{this.finishRowDrag()}
  private finishRowDrag():void{
    this.dragPreview?.remove();this.dragPreview=null;
    this.draggedRow=null;this.insertRowIndex=null;
  }
  trackRow(_i:number,row:Criterion):Criterion{return row}
  strategyLabel(key:string):string{return STRATEGIES.find(strategy=>strategy.key===key)?.label||key}
  etfLabel(isin:string):string{return this.allEtfs.find(etf=>etf.isin===isin)?.label||this.etfs.find(etf=>etf.isin===isin)?.label||isin}
  availableEtfs(row:Criterion):Etf[]{
    if(!row.isin || this.etfs.some(etf=>etf.isin===row.isin))return this.etfs;
    const found=this.allEtfs.find(etf=>etf.isin===row.isin);
    return [{isin:row.isin,label:found?.label||row.isin,search:found?.search||row.isin.toLowerCase()},...this.etfs];
  }
  private createRow(strategyKey='',isin='',benchmarkIsin='',signal:'buy'|'sell'='sell'):Criterion{
    return {strategyKey,isin,benchmarkIsin,thirdIsin:'',sixValues:[null,null,null,null,null,null],signal,price:null,average:null,benchmarkReturn:null,loading:false,benchmarkLoading:false,error:'',benchmarkSearch:'',searchOpen:false,version:0};
  }
  addCriterion():void{if(!this.currentPortfolioId||this.loadingSettings||this.draft)return;this.draft=this.createRow()}
  pendingRemoveRow:Criterion|null=null;
  requestRemoveCriterion(row:Criterion):void{this.pendingRemoveRow=row}
  cancelRemoveCriterion():void{this.pendingRemoveRow=null}
  confirmRemoveCriterion():void{
    const row=this.pendingRemoveRow;this.pendingRemoveRow=null;
    if(!row)return;
    const i=this.criteria.indexOf(row);if(i<0)return;
    this.clearRequests(row);this.criteria.splice(i,1);this.queueSave();
  }
  isImplemented(key:string):boolean{return ['sma-200','ts-momentum-12m','dual-sma-50-200','momentum-world-xeon'].includes(key)}
  changeStrategy(i:number,key:string):void{
    const row=this.rowAt(i);if(i!==-1||!row||!STRATEGIES.some(s=>s.key===key))return;
    this.clearRequests(row);row.strategyKey=key;row.price=null;row.average=null;row.error='';
    row.benchmarkIsin='';row.thirdIsin='';row.sixValues=[null,null,null,null,null,null];row.benchmarkSearch='';row.benchmarkReturn=null;

    // Draft configuration: no requests or writes before confirmation.
  }
  selectEtf(i:number,isin:string):void{
    if(i!==-1)return;
    const row=this.rowAt(i);if(!row)return;
    this.clearRequests(row);
    row.isin=isin;row.price=null;row.average=null;row.error='';
    // Quotations load only after confirmation.
  }
  private clearRequests(row:Criterion):void{row.subscription?.unsubscribe();row.benchmarkSubscription?.unsubscribe();row.version++;row.loading=false;row.benchmarkLoading=false}
  private loadThreeStates(row:Criterion):void{
    const version=++row.version;row.loading=true;row.error='';row.sixValues=[null,null,null,null,null,null];
    const isins=[row.isin,row.benchmarkIsin,row.thirdIsin];
    const histories=new Map<string,Map<string,number>>();
    const subs=isins.map(isin=>this.quotations.getQuotationHistory(isin,400).subscribe({
      next:(res:any)=>{
        if(row.version!==version)return;
        const prices=new Map<string,number>();
        for(const quote of (Array.isArray(res?.data)?res.data:[])){
          const price=Number(quote?.quotation),date=String(quote?.date||'').slice(0,10);
          if(price>0&&date&&!prices.has(date))prices.set(date,price);
        }
        histories.set(isin,prices);
        if(histories.size!==3)return;
        const [first,second,third]=isins.map(key=>histories.get(key)!);
        const dates=[...first.keys()].filter(date=>second.has(date)&&third.has(date)).sort().reverse();
        if(dates.length<100){row.error='Servono almeno 100 sedute comuni ai tre ETF.';row.loading=false;return}
        const ratios12=dates.slice(0,100).map(date=>first.get(date)!/second.get(date)!);
        const ratios23=dates.slice(0,100).map(date=>second.get(date)!/third.get(date)!);
        const current12=ratios12[0],current23=ratios23[0];
        const sma12=ratios12.reduce((sum,value)=>sum+value,0)/100;
        const sma23=ratios23.reduce((sum,value)=>sum+value,0)/100;
        row.sixValues=[current12,sma12,current23,sma23,current12-sma12,current23-sma23];
        row.loading=false;
      },
      error:()=>{if(row.version===version){row.error='Impossibile caricare le quotazioni A3Stati.';row.loading=false}}
    }));
    row.subscription=new Subscription();subs.forEach(sub=>row.subscription!.add(sub));
  }
  private loadQuote(row:Criterion):void{
    const version=++row.version;row.loading=true;row.error='';
    row.subscription=this.quotations.getQuotationHistory(row.isin,row.strategyKey==='ts-momentum-12m'?5000:300).subscribe({
      next:(response:any)=>{
        if(row.version!==version)return;
        const rows=(Array.isArray(response?.data)?response.data:[])
          .filter((x:any)=>Number(x?.quotation)>0).sort((a:any,b:any)=>String(b.date).localeCompare(String(a.date)));
        if(row.strategyKey==='ts-momentum-12m'){
          const pair=this.yearPrices(rows);row.price=pair?.current??null;row.average=pair?.past??null;
          if(!pair)row.error='Servono quotazioni risalenti ad almeno 12 mesi.';
        }else{
          if(rows.length<200)row.error='Servono almeno 200 quotazioni.';
          else{row.price=row.strategyKey==='dual-sma-50-200'?rows.slice(0,50).reduce((n:number,x:any)=>n+Number(x.quotation),0)/50:Number(rows[0].quotation);
            row.average=rows.slice(0,200).reduce((n:number,x:any)=>n+Number(x.quotation),0)/200;}
        }
        row.loading=false;
      },
      error:()=>{if(row.version===version){row.loading=false;row.error='Impossibile leggere le quotazioni.'}}
    });
  }
  private yearPrices(rows:any[]):{current:number;past:number}|null{
    if(!rows.length)return null;
    const latest=new Date(String(rows[0].date).slice(0,10)+'T12:00:00Z');
    if(Number.isNaN(latest.getTime()))return null;
    latest.setUTCFullYear(latest.getUTCFullYear()-1);
    const past=rows.find(x=>String(x.date).slice(0,10)<=latest.toISOString().slice(0,10));
    return past?{current:Number(rows[0].quotation),past:Number(past.quotation)}:null;
  }
  annualReturn(row:Criterion):number|null{return row.price!==null&&row.average!==null&&row.average>0&&!row.loading?(row.price/row.average-1)*100:null}
  private benchmarkValue(row:Criterion):number|null{return row.benchmarkIsin?row.benchmarkReturn:0}
  private delta(row:Criterion):number|null{
    if(!this.isImplemented(row.strategyKey)||row.loading||row.benchmarkLoading)return null;
    if(row.strategyKey==='momentum-world-xeon')return row.sixValues[4]!==null&&row.sixValues[5]!==null?Math.min(row.sixValues[4]!,row.sixValues[5]!):null;
    if(row.strategyKey==='ts-momentum-12m'){const a=this.annualReturn(row),b=this.benchmarkValue(row);return a===null||b===null?null:a-b}
    return row.price!==null&&row.average!==null?row.price-row.average:null;
  }
  isPositive(row:Criterion):boolean{return (this.delta(row)??0)>0}
  isNegative(row:Criterion):boolean{return (this.delta(row)??0)<0}
  formatPrice(v:number|null):string{return v===null?'—':new Intl.NumberFormat('it-IT',{minimumFractionDigits:2,maximumFractionDigits:2,useGrouping:true}).format(v)+' €'}
  formatPercent(v:number|null):string{return v===null?'—':(v>0?'+':'')+new Intl.NumberFormat('it-IT',{minimumFractionDigits:2,maximumFractionDigits:2,useGrouping:true}).format(v)+'%'}
  comparisonText(row:Criterion):string{return this.formatPercent(this.delta(row))}
  formatRatio(v:number|null):string{return v===null?'—':new Intl.NumberFormat('it-IT',{minimumFractionDigits:4,maximumFractionDigits:4}).format(v)}
  differenceText(row:Criterion):string{
    const d=this.delta(row);if(d===null)return '—';
    const pct=row.average&&row.average>0?this.formatPercent(d/row.average*100):'—';
    return (d>0?'+':'')+this.formatPrice(d)+' ('+pct+')';
  }
  filteredBenchmarks(row:Criterion):Etf[]{const q=row.benchmarkSearch.trim().toLowerCase();return this.allEtfs.filter(e=>!q||e.search.includes(q)).slice(0,40)}
  filterBenchmark(i:number,q:string):void{
    if(i!==-1)return;
    const row=this.rowAt(i);if(!row)return;
    if(row.benchmarkIsin){row.benchmarkSubscription?.unsubscribe();row.benchmarkIsin='';row.benchmarkReturn=null;if(i!==-1)this.queueSave()}
    row.benchmarkSearch=q;row.searchOpen=true;
  }
  closeBenchmark(i:number):void{setTimeout(()=>{const row=this.rowAt(i);if(row)row.searchOpen=false},120)}
  selectBenchmark(i:number,isin:string):void{
    if(i!==-1)return;
    const row=this.rowAt(i);if(!row)return;
    row.benchmarkSubscription?.unsubscribe();row.benchmarkIsin=isin;row.benchmarkReturn=null;row.benchmarkLoading=!!isin;
    row.benchmarkSearch=isin?(this.allEtfs.find(e=>e.isin===isin)?.label||isin):'';row.searchOpen=false;
    // Draft benchmark selection does not load prices or persist.
    if(!isin||i===-1)return;
    const version=row.version;
    row.benchmarkSubscription=this.quotations.getQuotationHistory(isin,5000).subscribe({
      next:(res:any)=>{
        if(row.version!==version||row.benchmarkIsin!==isin)return;
        const rows=(Array.isArray(res?.data)?res.data:[]).filter((x:any)=>Number(x?.quotation)>0).sort((a:any,b:any)=>String(b.date).localeCompare(String(a.date)));
        const pair=this.yearPrices(rows);row.benchmarkReturn=pair?(pair.current/pair.past-1)*100:null;row.benchmarkLoading=false;
        if(!pair)row.error='Confronto: servono almeno 12 mesi di quotazioni.';
      },
      error:()=>{if(row.version===version){row.benchmarkLoading=false;row.error='Impossibile leggere il benchmark.'}}
    });
  }
  private loadPortfolio():void{
    this.loadVersion++;const version=this.loadVersion;
    this.portfolioSub?.unsubscribe();this.settingsSub?.unsubscribe();this.catalogSub?.unsubscribe();
    this.criteria.forEach(row=>this.clearRequests(row));this.cancelDraft();this.criteria.splice(0);
    this.etfs=[];this.allEtfs=[];this.saveError='';this.portfolioMessage='';this.loadingSettings=false;this.saveQueued=false;
    this.catalogSub=this.api.getETFs().subscribe({next:(res:any)=>{
      if(version!==this.loadVersion)return;
      const rows=Array.isArray(res?.data)?res.data:Array.isArray(res)?res:[];
      this.allEtfs=rows.map((e:any)=>({isin:String(e.isin||'').toUpperCase(),label:(e.nickname||e.name||e.isin)+' ('+e.isin+')',
        search:[e.nickname,e.name,e.ticker,e.symbol,e.isin].filter(Boolean).join(' ').toLowerCase()})).filter((e:Etf)=>!!e.isin);
      this.criteria.forEach(row=>{if(row.benchmarkIsin)row.benchmarkSearch=this.allEtfs.find(e=>e.isin===row.benchmarkIsin)?.label||row.benchmarkIsin});
      if(this.draft?.benchmarkIsin)this.draft.benchmarkSearch=this.allEtfs.find(e=>e.isin===this.draft?.benchmarkIsin)?.label||this.draft.benchmarkIsin;
    }});
    const selected=this.portfolioSelection.selectedPortfolio();
    if(!selected){this.loadingPortfolio=false;this.portfolioMessage='Seleziona un portafoglio dalla navbar.';return}
    if(selected.tipo!=='reale'){this.loadingPortfolio=false;this.portfolioMessage='I criteri sono disponibili per i portafogli reali.';return}
    this.loadingPortfolio=true;
    this.portfolioSub=this.api.getRealPortfolioHoldings(selected.id).subscribe({
      next:(res:any)=>{
        if(version!==this.loadVersion)return;
        const unique=new Map<string,Etf>();
        for(const h of (Array.isArray(res?.data)?res.data:[])){
          const isin=String(h?.isin||h?.etf?.isin||'').toUpperCase();if(!isin)continue;
          const label=h?.nickname||h?.etf?.nickname||h?.name||h?.etf?.name||isin;
          unique.set(isin,{isin,label:label+' ('+isin+')',search:label.toLowerCase()});
        }
        this.etfs=[...unique.values()];this.loadingPortfolio=false;
        this.loadSaved(version,selected.id);
      },
      error:()=>{if(version===this.loadVersion){this.loadingPortfolio=false;this.portfolioMessage='Impossibile caricare gli ETF del portafoglio.'}}
    });
  }
  private loadSaved(version:number,portfolioId:string):void{
    this.loadingSettings=true;
    this.settingsSub=this.api.getTrendCriteria(portfolioId).subscribe({
      next:(res:any)=>{
        if(version!==this.loadVersion)return;
        const saved=Array.isArray(res?.data?.criteria)?res.data.criteria:[];
        for(const item of saved){
          if(!item.strategyKey || !STRATEGIES.some(s=>s.key===item.strategyKey))continue;
          const isin=String(item.isin||'').toUpperCase();
          const row=this.createRow(item.strategyKey,isin,String(item.benchmarkIsin||'').toUpperCase(),item.signal==='buy'?'buy':'sell');row.thirdIsin=String(item.thirdIsin||'').toUpperCase();
          this.criteria.push(row);if(row.strategyKey==='momentum-world-xeon'&&row.thirdIsin)this.loadThreeStates(row);else{if(row.isin&&this.isImplemented(row.strategyKey))this.loadQuote(row);if(row.benchmarkIsin)this.selectBenchmarkRestored(row)}
        }
        this.loadingSettings=false;
      },
      error:()=>{if(version===this.loadVersion){this.loadingSettings=false;this.saveError='Impossibile recuperare i criteri salvati.'}}
    });
  }
  private selectBenchmarkRestored(row:Criterion):void{this.loadRestoredBenchmark(row)}
  private loadRestoredBenchmark(row:Criterion):void{
    const isin=row.benchmarkIsin;
    const version=row.version;
    row.benchmarkSearch=this.allEtfs.find(e=>e.isin===isin)?.label||isin;
    row.benchmarkLoading=true;
    row.benchmarkSubscription=this.quotations.getQuotationHistory(isin,5000).subscribe({
      next:(res:any)=>{
        if(row.version!==version||row.benchmarkIsin!==isin)return;
        const quotes=(Array.isArray(res?.data)?res.data:[]).filter((x:any)=>Number(x?.quotation)>0).sort((a:any,b:any)=>String(b.date).localeCompare(String(a.date)));
        const pair=this.yearPrices(quotes);row.benchmarkReturn=pair?(pair.current/pair.past-1)*100:null;row.benchmarkLoading=false;
        if(!pair)row.error='Confronto: servono almeno 12 mesi di quotazioni.';
      },
      error:()=>{if(row.version===version){row.benchmarkLoading=false;row.error='Impossibile leggere il benchmark.'}}
    });
  }
  private queueSave():void{
    if(this.loadingSettings||!this.currentPortfolioId)return;
    this.saveQueued=true;if(!this.saving)this.flushSave();
  }
  private flushSave():void{
    if(!this.saveQueued){this.saving=false;return}
    const portfolioId=this.currentPortfolioId;if(!portfolioId){this.saving=false;return}
    this.saving=true;this.saveQueued=false;
    const payload=this.criteria.filter(row=>!!row.strategyKey).map(row=>({strategyKey:row.strategyKey,isin:row.isin,benchmarkIsin:row.benchmarkIsin,thirdIsin:row.thirdIsin,signal:row.signal}));
    this.saveSub=this.api.saveTrendCriteria(portfolioId,payload).subscribe({
      next:()=>{if(portfolioId===this.currentPortfolioId)this.saveError='';this.flushSave()},
      error:()=>{if(portfolioId===this.currentPortfolioId)this.saveError='Impossibile salvare i criteri.';this.saving=false}
    });
  }
  ngOnDestroy():void{
    this.finishRowDrag();this.loadVersion++;this.portfolioSub?.unsubscribe();this.catalogSub?.unsubscribe();this.settingsSub?.unsubscribe();this.saveSub?.unsubscribe();
    this.criteria.forEach(row=>this.clearRequests(row));this.cancelDraft();
  }
}
