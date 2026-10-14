import { Component, effect, inject, OnDestroy, untracked } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Subscription } from 'rxjs';
import { ApiService } from '../../core/api/api.service';
import { QuotationService } from '../../core/services/quotation.service';
import { PortfolioSelectionService } from '../../core/services/portfolio-selection.service';

interface Etf { isin: string; label: string; search: string }
interface Criterion {
  strategyKey: string; isin: string; benchmarkIsin: string;
  price: number | null; average: number | null; benchmarkReturn: number | null;
  loading: boolean; benchmarkLoading: boolean; error: string;
  benchmarkSearch: string; searchOpen: boolean; version: number;
  subscription?: Subscription; benchmarkSubscription?: Subscription;
}
const STRATEGIES = [
  { key: 'sma-200', label: 'Media mobile 200 giorni' },
  { key: 'ts-momentum-12m', label: 'Time Series 12 mesi' },
  { key: 'dual-sma-50-200', label: 'Doppia media mobile 50/200' }
];
@Component({
  selector: 'app-trend-following-page',
  standalone: true,
  imports: [CommonModule],
  template: `
    <section class="trend-page">
      <p *ngIf="saveError" class="error" role="alert">{{saveError}}</p>
      <p *ngIf="portfolioMessage" class="hint">{{portfolioMessage}}</p>
      <div class="criteria-list">
        <article *ngFor="let row of criteria; let i=index; trackBy:trackRow" class="criterion"
          [class.positive]="isPositive(row)" [class.negative]="isNegative(row)">
          <select class="strategy-select" [value]="row.strategyKey" (change)="changeStrategy(i,$any($event.target).value)" [attr.aria-label]="'Strategia criterio '+(i+1)">
            <option value="">Seleziona criterio</option>
            <option *ngFor="let strategy of strategies" [value]="strategy.key">{{strategy.label}}</option>
          </select>
          <select class="etf-select" [value]="row.isin" (change)="selectEtf(i,$any($event.target).value)"
            [disabled]="loadingPortfolio || !etfs.length" [attr.aria-label]="'ETF criterio '+(i+1)">
            <option value="">Seleziona ETF</option>
            <option *ngFor="let etf of etfs" [value]="etf.isin">{{etf.label}}</option>
          </select>
          <ng-container *ngIf="row.strategyKey === 'ts-momentum-12m'">
            <span class="compare-sign">&gt;</span>
            <div class="benchmark-search">
              <input type="text" [value]="row.benchmarkSearch" (input)="filterBenchmark(i,$any($event.target).value)"
                (focus)="row.searchOpen=true" (blur)="closeBenchmark(i)"
                placeholder="Confronto: ETF o 0%" [attr.aria-label]="'ETF confronto '+(i+1)" autocomplete="off">
              <button *ngIf="row.benchmarkIsin || row.benchmarkSearch" class="clear" type="button" (mousedown)="$event.preventDefault()" (click)="selectBenchmark(i,'')">×</button>
              <div *ngIf="row.searchOpen" class="benchmark-options">
                <button type="button" (mousedown)="$event.preventDefault();selectBenchmark(i,'')">Nessun ETF — 0%</button>
                <button *ngFor="let etf of filteredBenchmarks(row)" type="button" (mousedown)="$event.preventDefault();selectBenchmark(i,etf.isin)">{{etf.label}}</button>
              </div>
            </div>
          </ng-container>
          <div class="metric" [title]="row.strategyKey === 'dual-sma-50-200' ? 'Media mobile 50 giorni' : row.strategyKey === 'ts-momentum-12m' ? 'Rendimento 12 mesi ETF' : 'Prezzo'">
            {{row.loading ? '—' : row.strategyKey === 'ts-momentum-12m' ? formatPercent(annualReturn(row)) : formatPrice(row.price)}}
          </div>
          <div class="metric" [title]="row.strategyKey === 'ts-momentum-12m' ? 'Rendimento 12 mesi confronto' : 'Media mobile 200 giorni'">
            {{row.loading || row.benchmarkLoading ? '—' : row.strategyKey === 'ts-momentum-12m' ? formatPercent(row.benchmarkIsin ? row.benchmarkReturn : 0) : formatPrice(row.average)}}
          </div>
          <div class="metric outcome" [title]="row.error || 'Differenza'">
            {{row.strategyKey === 'ts-momentum-12m' ? comparisonText(row) : differenceText(row)}}
          </div>
          <button type="button" class="remove" (click)="removeCriterion(i)" [attr.aria-label]="'Elimina criterio '+(i+1)">×</button>
          <span *ngIf="row.error" class="row-error">{{row.error}}</span>
        </article>
      </div>
      <article class="suggestions">
        <h3><span class="material-symbols-rounded icon">emoji_objects</span>Suggerimenti</h3>
        <p>Nessun suggerimento disponibile.</p>
      </article>
    </section>
  `,
  styles: [`
    .trend-page{display:flex;flex-direction:column;min-height:calc(100dvh - 190px);gap:12px}
    .criteria-list{display:flex;flex-direction:column;gap:8px;padding-top:8px}
    .criterion{display:flex;align-items:center;gap:8px;padding:9px 12px;border:1px solid rgba(100,139,182,.42);border-radius:11px;background:rgba(12,25,42,.85);min-width:0;flex-wrap:wrap}
    .criterion.positive{border-color:#48d1a3;background:rgba(24,90,72,.20)}
    .criterion.negative{border-color:#f07181;background:rgba(110,35,48,.20)}
    select,.benchmark-search input{height:39px;box-sizing:border-box;background:#203554;color:#edf4ff;border:1px solid #50769f;border-radius:7px;padding:0 9px;min-width:0;font:inherit}
    .strategy-select{flex:0 1 21%;max-width:280px}.etf-select{flex:1 1 18%;min-width:130px}
    .benchmark-search{flex:1 1 15%;min-width:120px;position:relative}.benchmark-search input{width:100%;padding-right:26px}
    .compare-sign{font-weight:700;font-size:19px}.clear{position:absolute;right:5px;top:6px;background:transparent;border:0;color:white;font-size:20px;cursor:pointer}
    .benchmark-options{position:absolute;z-index:50;top:42px;left:0;right:0;max-height:240px;overflow:auto;background:#142943;border:1px solid #6085b5;border-radius:8px}
    .benchmark-options button{display:block;width:100%;text-align:left;color:white;background:transparent;border:0;padding:9px;cursor:pointer}
    .benchmark-options button:hover{background:#2b4e7d}
    .metric{flex:0 1 104px;min-width:80px;min-height:39px;display:flex;align-items:center;justify-content:center;padding:0 6px;box-sizing:border-box;border:1px solid rgba(115,150,190,.34);border-radius:7px;background:rgba(30,51,80,.62);font-weight:600;font-size:13px;white-space:nowrap}
    .outcome{flex:1 1 155px;min-width:130px}.positive .outcome{color:#66dfb1}.negative .outcome{color:#ff8d9c}
    .remove{border:0;background:transparent;color:#fa8190;cursor:pointer;font-size:21px}
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
  readonly headerActionLabel='AGGIUNGI CRITERIO';
  readonly headerActionIcon='add';
  get headerActionDisabled():boolean{return !this.currentPortfolioId || this.loadingPortfolio || this.loadingSettings || this.muGenerating}
  get headerActionRunning():boolean{return this.muGenerating}
  get headerActionProgress():number{return this.muGenerating?Math.max(1,this.muProgress):0}
  muGenerating=false;muProgress=0;
  setMarketUniverseGenerationStatus(running:boolean,progress:number):void{this.muGenerating=running;this.muProgress=progress}
  runHeaderAction():void{this.addCriterion()}
  readonly criteria:Criterion[]=[];
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
  trackRow(_i:number,row:Criterion):Criterion{return row}
  private createRow(strategyKey='',isin='',benchmarkIsin=''):Criterion{
    return {strategyKey,isin,benchmarkIsin,price:null,average:null,benchmarkReturn:null,loading:false,benchmarkLoading:false,error:'',benchmarkSearch:'',searchOpen:false,version:0};
  }
  addCriterion():void{if(!this.currentPortfolioId||this.loadingSettings)return;this.criteria.push(this.createRow());this.queueSave()}
  removeCriterion(i:number):void{const row=this.criteria[i];if(!row)return;this.clearRequests(row);this.criteria.splice(i,1);this.queueSave()}
  changeStrategy(i:number,key:string):void{
    const row=this.criteria[i];if(!row||!STRATEGIES.some(s=>s.key===key))return;
    this.clearRequests(row);row.strategyKey=key;row.price=null;row.average=null;row.error='';
    row.benchmarkIsin='';row.benchmarkSearch='';row.benchmarkReturn=null;
    if(row.isin)this.loadQuote(row);this.queueSave();
  }
  selectEtf(i:number,isin:string):void{
    const row=this.criteria[i];if(!row)return;this.clearRequests(row);
    row.isin=isin;row.price=null;row.average=null;row.error='';
    if(isin&&row.strategyKey)this.loadQuote(row);this.queueSave();
  }
  private clearRequests(row:Criterion):void{row.subscription?.unsubscribe();row.benchmarkSubscription?.unsubscribe();row.version++;row.loading=false;row.benchmarkLoading=false}
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
    if(row.loading||row.benchmarkLoading)return null;
    if(row.strategyKey==='ts-momentum-12m'){const a=this.annualReturn(row),b=this.benchmarkValue(row);return a===null||b===null?null:a-b}
    return row.price!==null&&row.average!==null?row.price-row.average:null;
  }
  isPositive(row:Criterion):boolean{return (this.delta(row)??0)>0}
  isNegative(row:Criterion):boolean{return (this.delta(row)??0)<0}
  formatPrice(v:number|null):string{return v===null?'—':new Intl.NumberFormat('it-IT',{minimumFractionDigits:2,maximumFractionDigits:2}).format(v)+' €'}
  formatPercent(v:number|null):string{return v===null?'—':(v>0?'+':'')+new Intl.NumberFormat('it-IT',{maximumFractionDigits:2}).format(v)+'%'}
  comparisonText(row:Criterion):string{return this.formatPercent(this.delta(row))}
  differenceText(row:Criterion):string{
    const d=this.delta(row);if(d===null)return '—';
    const pct=row.average&&row.average>0?this.formatPercent(d/row.average*100):'—';
    return (d>0?'+':'')+this.formatPrice(d)+' ('+pct+')';
  }
  filteredBenchmarks(row:Criterion):Etf[]{const q=row.benchmarkSearch.trim().toLowerCase();return this.allEtfs.filter(e=>!q||e.search.includes(q)).slice(0,40)}
  filterBenchmark(i:number,q:string):void{
    const row=this.criteria[i];if(!row)return;
    if(row.benchmarkIsin){row.benchmarkSubscription?.unsubscribe();row.benchmarkIsin='';row.benchmarkReturn=null;this.queueSave()}
    row.benchmarkSearch=q;row.searchOpen=true;
  }
  closeBenchmark(i:number):void{setTimeout(()=>{if(this.criteria[i])this.criteria[i].searchOpen=false},120)}
  selectBenchmark(i:number,isin:string):void{
    const row=this.criteria[i];if(!row)return;
    row.benchmarkSubscription?.unsubscribe();row.benchmarkIsin=isin;row.benchmarkReturn=null;row.benchmarkLoading=!!isin;
    row.benchmarkSearch=isin?(this.allEtfs.find(e=>e.isin===isin)?.label||isin):'';row.searchOpen=false;
    this.queueSave();if(!isin)return;
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
    this.criteria.forEach(row=>this.clearRequests(row));this.criteria.splice(0);
    this.etfs=[];this.allEtfs=[];this.saveError='';this.portfolioMessage='';this.loadingSettings=false;this.saveQueued=false;
    this.catalogSub=this.api.getETFs().subscribe({next:(res:any)=>{
      if(version!==this.loadVersion)return;
      const rows=Array.isArray(res?.data)?res.data:Array.isArray(res)?res:[];
      this.allEtfs=rows.map((e:any)=>({isin:String(e.isin||'').toUpperCase(),label:(e.nickname||e.name||e.isin)+' ('+e.isin+')',
        search:[e.nickname,e.name,e.ticker,e.symbol,e.isin].filter(Boolean).join(' ').toLowerCase()})).filter((e:Etf)=>!!e.isin);
      this.criteria.forEach(row=>{if(row.benchmarkIsin)row.benchmarkSearch=this.allEtfs.find(e=>e.isin===row.benchmarkIsin)?.label||row.benchmarkIsin});
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
          if(item.strategyKey && !STRATEGIES.some(s=>s.key===item.strategyKey))continue;
          const row=this.createRow(item.strategyKey,String(item.isin||'').toUpperCase(),String(item.benchmarkIsin||'').toUpperCase());
          this.criteria.push(row);if(row.isin&&row.strategyKey)this.loadQuote(row);
          if(row.benchmarkIsin)this.selectBenchmarkRestored(row);
        }
        this.loadingSettings=false;
      },
      error:()=>{if(version===this.loadVersion){this.loadingSettings=false;this.saveError='Impossibile recuperare i criteri salvati.'}}
    });
  }
  private selectBenchmarkRestored(row:Criterion):void{
    const isin=row.benchmarkIsin;row.benchmarkIsin='';
    const i=this.criteria.indexOf(row);this.selectBenchmark(i,isin);
  }
  private queueSave():void{
    if(this.loadingSettings||!this.currentPortfolioId)return;
    this.saveQueued=true;if(!this.saving)this.flushSave();
  }
  private flushSave():void{
    if(!this.saveQueued){this.saving=false;return}
    const portfolioId=this.currentPortfolioId;if(!portfolioId){this.saving=false;return}
    this.saving=true;this.saveQueued=false;
    const payload=this.criteria.map(row=>({strategyKey:row.strategyKey,isin:row.isin,benchmarkIsin:row.benchmarkIsin}));
    this.saveSub=this.api.saveTrendCriteria(portfolioId,payload).subscribe({
      next:()=>{if(portfolioId===this.currentPortfolioId)this.saveError='';this.flushSave()},
      error:()=>{if(portfolioId===this.currentPortfolioId)this.saveError='Impossibile salvare i criteri.';this.saving=false}
    });
  }
  ngOnDestroy():void{
    this.loadVersion++;this.portfolioSub?.unsubscribe();this.catalogSub?.unsubscribe();this.settingsSub?.unsubscribe();this.saveSub?.unsubscribe();
    this.criteria.forEach(row=>this.clearRequests(row));
  }
}
