import { CommonModule } from '@angular/common';
import { Component, HostListener, OnInit, effect, signal, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { UiCardComponent } from '../../shared/components/ui-card/ui-card.component';
import { UiButtonComponent } from '../../shared/components/ui-button/ui-button.component';
import { LineChartComponent, LineChartSeries, LineChartTick } from '../../shared/components/line-chart/line-chart.component';
import { ChartLegendComponent, ChartLegendItem } from '../../shared/components/chart-legend/chart-legend.component';
import { ChartTooltipComponent } from '../../shared/components/chart-tooltip/chart-tooltip.component';
import { ApiService } from '../../core/api/api.service';
import { ActionConfirmationService } from '../../core/services/action-confirmation.service';
import { PortfolioSelectionService } from '../../core/services/portfolio-selection.service';

interface Portfolio { id:string; name:string; description?:string|null; status:string; marketValue?:number; investedCapital?:number; gainLoss?:number; gainLossPercent?:number; quotationDate?:string|null; }
interface Holding { name:string; nickname:string; ticker:string; assetClass:string; qty:string; avg:string; price:string; value:string; marketValue:number|null; gain:string; weight:string; tone:'positive'|'negative'|'neutral'; }
interface Operation { date:string; type:'Acquisto'|'Vendita'|'Ritenuta'; isin:string; etf:string; qty:string; price:string; total:string; }

@Component({
  selector:'app-real-portfolios-page',
  standalone:true,
  imports:[CommonModule,FormsModule,RouterLink,UiCardComponent,UiButtonComponent,LineChartComponent,ChartLegendComponent,ChartTooltipComponent],
  templateUrl:'./real-portfolios-page.component.html',
  styleUrls:['./real-portfolios-page.component.css']
})
export class RealPortfoliosPageComponent implements OnInit {
  readonly headerActionLabel='AGGIORNA QUOTAZIONI';
  readonly headerActionIcon='sync';
  quotationRefreshRunning=false;
  headerActionProgress=0;
  private quotationProgressTimer:any=null;
  private quotationFinishTimer:any=null;
  get headerActionDisabled():boolean { return this.loadingPortfolios || this.portfolios.length===0 || !this.hasSelectedPortfolio || this.quotationRefreshRunning; }
  get headerActionRunning():boolean { return this.quotationRefreshRunning; }
  private readonly actionConfirmation = inject(ActionConfirmationService);
  runHeaderAction():void {
    const portfolio=this.portfolios[this.selected];
    if(!portfolio || this.quotationRefreshRunning)return;
    this.actionConfirmation.ask(`Aggiornare le quotazioni del portafoglio ${portfolio.name}?`, 'Aggiorna', () => this.executeQuotationRefresh(portfolio.id));
  }

  private executeQuotationRefresh(portfolioId:string):void {
    if (this.quotationRefreshRunning) return;

    // The refresh POST must be the first request. Previously a preliminary GET
    // /holdings could be satisfied with HTTP 304 and prevent the refresh chain
    // from reaching EODHD in some browser/cache paths.
    this.quotationRefreshRunning=true;
    this.headerActionProgress=1;
    this.startQuotationProgress(Math.max(1,this.holdings.length));

    this.api.refreshRealPortfolioQuotations(portfolioId).subscribe({
      next:()=>{
        this.loadMarketValues();
        this.loadHoldings();
        this.loadHistory();
        this.finishQuotationProgress();
      },
      error:(error)=>{
        this.resetQuotationProgress();
        console.error('Errore aggiornamento quotazioni portafoglio',error);
      }
    });
  }
  private startQuotationProgress(etfCount:number):void {
    if(this.quotationProgressTimer)clearInterval(this.quotationProgressTimer);
    const duration=Math.max(1,etfCount)*5000;
    const started=Date.now();
    this.quotationProgressTimer=setInterval(()=>{
      const elapsed=Date.now()-started;
      this.headerActionProgress=Math.min(80,Math.max(1,Math.round(1+(79*elapsed/duration))));
      if(this.headerActionProgress>=80){clearInterval(this.quotationProgressTimer);this.quotationProgressTimer=null;}
    },100);
  }
  private finishQuotationProgress():void {
    if(this.quotationProgressTimer){clearInterval(this.quotationProgressTimer);this.quotationProgressTimer=null;}
    if(this.quotationFinishTimer)clearInterval(this.quotationFinishTimer);
    this.quotationFinishTimer=setInterval(()=>{
      this.headerActionProgress=Math.min(100,this.headerActionProgress+4);
      if(this.headerActionProgress>=100){
        clearInterval(this.quotationFinishTimer);this.quotationFinishTimer=null;
        setTimeout(()=>{this.quotationRefreshRunning=false;this.headerActionProgress=0;},250);
      }
    },35);
  }
  private resetQuotationProgress():void {
    if(this.quotationProgressTimer){clearInterval(this.quotationProgressTimer);this.quotationProgressTimer=null;}
    if(this.quotationFinishTimer){clearInterval(this.quotationFinishTimer);this.quotationFinishTimer=null;}
    this.headerActionProgress=0;this.quotationRefreshRunning=false;
  }

  portfolios:Portfolio[]=[];
  selected=0;
  loadingPortfolios=true;
  showCreateDialog=signal(false);
  portfolioName=signal('');
  portfolioDescription=signal('');
  creating=false;
  createProgress=0;
  private createProgressTimer:any=null;
  private createFinishTimer:any=null;
  get portfolioNameUnavailable():boolean {
    const name=this.portfolioName().trim().toLocaleLowerCase();
    return !!name && this.portfolioSelection.portfolioOptions().some((p)=>p.label.trim().toLocaleLowerCase()===name);
  }
  openPortfolioMenu:string|null=null;
  portfolioPendingDelete:Portfolio|null=null;
  deletingPortfolio=false;
  operationPortfolio:Portfolio|null=null;
  operationType:'buy'|'sell'='buy';
  ownedEtfs:any[]=[];
  operationEtfQuery='';
  operationEtfResults:any[]=[];
  operationEtf:any|null=null;
  operationDate=new Date().toISOString().slice(0,10);
  operationQuantity:string='';
  operationUnitPrice:string='';
  savingOperation=false;
  private operationSearchTimer:any=null;
  private initialized=false;
  private draggedPortfolioIndex:number|null=null;
  private portfolioDragOriginalOrder:Portfolio[]|null=null;
  portfolioDragSourceIndex:number|null=null;
  portfolioDragTargetIndex:number|null=null;
  suppressPortfolioDragTransitions=false;
  portfolioDragPreview:HTMLElement|null=null;
  portfolioDragPreviewOffset={x:0,y:0};

  constructor(private readonly api:ApiService, private readonly portfolioSelection:PortfolioSelectionService) {
    effect(() => {
      // A portfolio selection change only switches the local view; it must not reload real portfolios.
      this.portfolioSelection.refreshVersion();

      const selectedId = this.portfolioSelection.selectedPortfolio()?.id;
      if (selectedId) {
        const index = this.portfolios.findIndex((portfolio) => portfolio.id === selectedId);
        if (index >= 0 && index !== this.selected) {
          this.selected = index;
          this.loadOperations();
          this.loadHoldings();
          this.loadHistory();
        }
        return;
      }

      // A hidden simulated selection remains global until the user explicitly selects a real portfolio.
    });
  }

  ngOnInit():void {
    this.initialized=true;
    this.loadRealPortfolios();
  }

  private loadRealPortfolios():void {
    this.loadingPortfolios=true;
    this.api.getRealPortfolios().subscribe({
      next:(response:any)=>{
        this.portfolios=Array.isArray(response?.data)?response.data:[];
        const selectedId=this.portfolioSelection.selectedPortfolio()?.id;
        const selectedIndex=selectedId ? this.portfolios.findIndex((portfolio)=>portfolio.id===selectedId) : -1;
        this.selected=selectedIndex>=0 ? selectedIndex : 0;
        this.loadingPortfolios=false;
        if (this.portfolios.length && selectedIndex < 0) {
          // Keep the global selection when it is a laboratory portfolio;
          // select the first real card locally and synchronize the navbar on entry.
          this.portfolioSelection.setSelectedPortfolio(this.portfolios[0].id);
        } else if (!this.portfolios.length && !selectedId) this.portfolioSelection.setSelectedPortfolio(null);
        this.loadOperations();
        this.loadMarketValues();
        this.loadHoldings();
        this.loadHistory();
      },
      error:()=>{ this.portfolios=[]; this.loadingPortfolios=false; }
    });
  }

  get hasSelectedPortfolio():boolean { return this.portfolios.length>0 && !!this.portfolios[this.selected]; }

  openCreatePortfolio():void { this.portfolioName.set(''); this.portfolioDescription.set(''); this.showCreateDialog.set(true); }
  discardCreatePortfolio():void { if(this.creating)return; this.showCreateDialog.set(false); this.portfolioName.set(''); this.portfolioDescription.set(''); this.resetCreateProgress(); }
  private startCreateProgress():void {
    this.resetCreateProgress(); this.creating=true; this.createProgress=1;
    this.createProgressTimer=setInterval(()=>{ const remaining=80-this.createProgress; if(remaining>0)this.createProgress=Math.min(80,this.createProgress+Math.max(.7,remaining*.09)); },90);
  }
  private finishCreateProgress(done:()=>void):void {
    if(this.createProgressTimer){clearInterval(this.createProgressTimer);this.createProgressTimer=null;}
    this.createFinishTimer=setInterval(()=>{this.createProgress=Math.min(100,this.createProgress+Math.max(4,(100-this.createProgress)*.32));if(this.createProgress>=100){clearInterval(this.createFinishTimer);this.createFinishTimer=null;setTimeout(()=>{this.creating=false;this.createProgress=0;done();},180);}},35);
  }
  private resetCreateProgress():void {
    if(this.createProgressTimer){clearInterval(this.createProgressTimer);this.createProgressTimer=null;}
    if(this.createFinishTimer){clearInterval(this.createFinishTimer);this.createFinishTimer=null;}
    this.createProgress=0; this.creating=false;
  }
  createPortfolio():void {
    const name=this.portfolioName().trim(); if(!name||this.creating||this.portfolioNameUnavailable||this.portfolios.length>=5)return;
    this.startCreateProgress();
    this.api.createRealPortfolio({name, description:this.portfolioDescription().trim() || null}).subscribe({
      next:(res:any)=>this.finishCreateProgress(()=>{if(res?.data)this.portfolios=[...this.portfolios,res.data];this.selected=Math.max(0,this.portfolios.length-1);this.showCreateDialog.set(false);this.portfolioName.set('');this.portfolioDescription.set('');this.portfolioSelection.loadPortfolios();}),
      error:()=>this.resetCreateProgress()
    });
  }
  get kpis(){
    const p=this.portfolios[this.selected];
    const value=p?.marketValue ?? 0, gain=p?.gainLoss ?? 0, pct=p?.gainLossPercent ?? 0;
    const tone=this.valueTone(gain), sign=gain>0?'+ ':gain<0?'- ':'';
    return [
    ['Valore di mercato',this.formatCurrency(value),`${sign}${this.formatCurrency(Math.abs(gain))}  (${this.formatSignedPercent(pct)})`,tone],
    ['Capitale investito',this.formatCurrencyTrailing(p?.investedCapital ?? 0),'',''],
    ['Gain/Loss',`${sign}${this.formatCurrency(Math.abs(gain))}`,this.formatSignedPercent(pct),tone],
    ['Rendimento annuo (TWR)',this.performance.annualReturn === null ? '—' : this.formatSignedPercent(this.performance.annualReturn),'',this.performance.annualReturn === null ? '' : this.valueTone(this.performance.annualReturn)],
    ['Volatilità annua',this.performance.volatility === null ? '—' : this.formatSignedPercent(this.performance.volatility).replace(/^\+/,''),'',''],
    ['Numero ETF',String(this.holdings.length),'','']
  ];
  }
  holdings:Holding[]=[];
  compositionTab:'etf'|'asset'='etf';
  readonly compositionColors=['#2D91FF','#31D48D','#FF526C','#FF9F43','#9B67ED','#21C7C7','#F9BE48','#E96BA8','#64A7FF','#86D957'];
  get compositionTotal():number { return this.holdings.reduce((sum,h)=>sum+(h.marketValue ?? 0),0); }
  get compositionItems():Array<{label:string;value:number;weight:number;color:string}> {
    if(this.compositionTotal<=0)return [];
    if(this.compositionTab==='etf') {
      return this.holdings
        .filter(h=>h.marketValue!==null && h.marketValue>0)
        .map((h,index)=>({label:h.nickname||h.name,value:h.marketValue!,weight:h.marketValue!/this.compositionTotal*100,color:this.compositionColors[index%this.compositionColors.length]}));
    }
    const grouped=new Map<string,number>();
    for(const holding of this.holdings) {
      if(holding.marketValue===null || holding.marketValue<=0)continue;
      const label=holding.assetClass?.trim() || 'Non classificato';
      grouped.set(label,(grouped.get(label)||0)+holding.marketValue);
    }
    return Array.from(grouped.entries()).map(([label,value],index)=>({label,value,weight:value/this.compositionTotal*100,color:this.compositionColors[index%this.compositionColors.length]}));
  }
  get compositionDonutStyle():string {
    const items=this.compositionItems;
    if(!items.length)return 'conic-gradient(rgba(77,125,181,.18) 0 100%)';
    let cursor=0;
    const stops=items.map(item=>{const start=cursor;cursor+=item.weight;return `${item.color} ${start}% ${cursor}%`;});
    return `conic-gradient(${stops.join(',')})`;
  }
  setCompositionTab(tab:'etf'|'asset'):void { this.compositionTab=tab; this.compositionHoverIndex=null; }
  compositionHoverIndex:number|null=null;
  compositionTooltip={x:0,y:0,visible:false};
  compositionOffset(index:number):number {
    return -this.compositionItems.slice(0,index).reduce((sum,item)=>sum+item.weight,0);
  }
  compositionSliceTransform(index:number):string {
    if(this.compositionHoverIndex!==index)return 'translate(0 0)';
    const items=this.compositionItems;
    const before=items.slice(0,index).reduce((sum,item)=>sum+item.weight,0);
    // The whole SVG is already rotated -90deg: calculate the slice midpoint in its
    // native coordinates so the translated slice moves exactly away from the centre.
    const angle=(before+(items[index]?.weight??0)/2)*3.6;
    const radians=angle*Math.PI/180;
    const distance=.45;
    const dx=Math.cos(radians)*distance;
    const dy=Math.sin(radians)*distance;
    // A small outward translation plus scale reads as elevation; the base slice is
    // hidden while this overlay is active, so the interaction never duplicates it.
    return `translate(${dx.toFixed(2)} ${dy.toFixed(2)}) scale(1.035)`;
  }
  hoverComposition(index:number,event:MouseEvent):void {
    this.compositionHoverIndex=index;
    this.moveCompositionTooltip(event);
  }
  moveCompositionTooltip(event:MouseEvent):void {
    this.compositionTooltip={x:event.clientX+14,y:event.clientY-14,visible:true};
  }
  leaveComposition():void { this.compositionHoverIndex=null; this.compositionTooltip={...this.compositionTooltip,visible:false}; }
  operations:Operation[]=[];
  private readonly riskFreeRate = 0.02;
  get performance() {
    const rows = this.history
      .filter(row => row.valuation !== 'incomplete' && Number.isFinite(row.performancePercent))
      .slice().sort((a,b) => a.date.localeCompare(b.date));
    const empty = { totalReturn:null as number|null, annualReturn:null as number|null, volatility:null as number|null,
      sharpe:null as number|null, maxDrawdown:null as number|null, bestMonth:null as number|null,
      worstMonth:null as number|null, positiveMonths:0, months:0 };
    if (rows.length < 2) return empty;
    const index = (row: typeof rows[number]) => 1 + Number(row.performancePercent) / 100;
    const start = index(rows[0]), end = index(rows[rows.length-1]);
    if (!(start > 0 && end > 0)) return empty;
    const days = (Date.parse(rows[rows.length-1].date+'T00:00:00Z') - Date.parse(rows[0].date+'T00:00:00Z')) / 86400000;
    const annualReturn = days >= 30 ? (Math.pow(end/start,365.25/days)-1)*100 : null;
    const returns:number[] = [];
    let peak = start, maxDrawdown = 0;
    for (let i=0;i<rows.length;i++) {
      const current = index(rows[i]);
      if (!(current > 0)) continue;
      peak = Math.max(peak,current);
      maxDrawdown = Math.min(maxDrawdown,(current/peak-1)*100);
      if(i>0) {
        const previous=index(rows[i-1]);
        if(previous>0 && rows[i].date!==rows[i-1].date) returns.push(current/previous-1);
      }
    }
    const mean=returns.length ? returns.reduce((a,b)=>a+b,0)/returns.length : 0;
    const variance=returns.length>1 ? returns.reduce((sum,r)=>sum+(r-mean)**2,0)/(returns.length-1) : 0;
    const volatility=returns.length>=20 ? Math.sqrt(variance)*Math.sqrt(252)*100 : null;
    const sharpe=volatility!==null && volatility>0 && annualReturn!==null ? (annualReturn-this.riskFreeRate*100)/volatility : null;
    const months=new Map<string,typeof rows[number]>();
    for(const row of rows) months.set(row.date.slice(0,7),row);
    const monthRows=[...months.values()].sort((a,b)=>a.date.localeCompare(b.date));
    const monthReturns:number[]=[];
    for(let i=1;i<monthRows.length;i++) {
      const prev=index(monthRows[i-1]),current=index(monthRows[i]);
      if(prev>0 && current>0) monthReturns.push((current/prev-1)*100);
    }
    return { totalReturn:(end/start-1)*100, annualReturn, volatility, sharpe, maxDrawdown,
      bestMonth:monthReturns.length?Math.max(...monthReturns):null,
      worstMonth:monthReturns.length?Math.min(...monthReturns):null,
      positiveMonths:monthReturns.filter(r=>r>0).length, months:monthReturns.length };
  }
  get stats():string[][] {
    const p=this.performance;
    const pct=(v:number|null)=>v===null?'—':this.formatSignedPercent(v);
    const tone=(v:number|null)=>v===null?'':this.valueTone(v);
    return [
      ['Rendimento totale (TWR)',pct(p.totalReturn),tone(p.totalReturn)],
      ['Rendimento annuo (TWR)',pct(p.annualReturn),tone(p.annualReturn)],
      ['Volatilità annua',p.volatility===null?'—':pct(p.volatility).replace(/^\\+/,''),''],
      ['Sharpe ratio',p.sharpe===null?'—':p.sharpe.toLocaleString('it-IT',{minimumFractionDigits:2,maximumFractionDigits:2}),''],
      ['Massimo drawdown',pct(p.maxDrawdown),tone(p.maxDrawdown)],
      ['Mese migliore',pct(p.bestMonth),tone(p.bestMonth)],
      ['Mese peggiore',pct(p.worstMonth),tone(p.worstMonth)],
      ['Mesi positivi',p.months? p.positiveMonths+' su '+p.months+' ('+(p.positiveMonths/p.months*100).toFixed(0)+'%)':'—','']
    ];
  }
  readonly legend:ChartLegendItem[]=[
    {label:'Valore del portafoglio',color:'#2586d9'},
    {label:'Capitale netto investito',color:'#9ab2cf'}
  ];
  history:Array<{date:string;month:string;marketValue:number|null;netContributions:number;performancePercent:number;valuation:string;estimatedPositions:number}>=[];
  historyPeriod:'1Y'|'3Y'|'5Y'|'MAX'='MAX';
  historyMode:'value'|'performance'='value';
  historyLoading=false;
  get visibleHistory(){
    const days=this.historyPeriod==='MAX'?Infinity:this.historyPeriod==='1Y'?365:this.historyPeriod==='3Y'?1095:1826;
    if(days===Infinity)return this.history;
    const cutoff=new Date();cutoff.setUTCDate(cutoff.getUTCDate()-days);
    const min=cutoff.toISOString().slice(0,10);
    return this.history.filter(row=>row.date>=min);
  }
  setHistoryPeriod(period:'1Y'|'3Y'|'5Y'|'MAX'):void {this.historyPeriod=period;}
  setHistoryMode(mode:'value'|'performance'):void {this.historyMode=mode;}
  private loadHistory():void {
    const portfolio=this.portfolios[this.selected];
    if(!portfolio){this.history=[];return;}
    this.historyLoading=true;
    this.api.getRealPortfolioHistory(portfolio.id).subscribe({
      next:(response:any)=>{
        if(this.portfolios[this.selected]?.id!==portfolio.id)return;
        this.history=Array.isArray(response?.data)?response.data:[];
        this.historyLoading=false;
      },
      error:(error)=>{this.historyLoading=false;this.history=[];console.error('Errore storico portafoglio',error);}
    });
  }
  get historyMonths():string[]{
    const rows=this.visibleHistory;
    if(!rows.length)return [];
    const indexes=[0,Math.floor((rows.length-1)/4),Math.floor((rows.length-1)/2),Math.floor(3*(rows.length-1)/4),rows.length-1];
    return [...new Set(indexes)].map(i=>new Intl.DateTimeFormat('it-IT',{month:'short',year:'numeric'}).format(new Date(rows[i].date+'T12:00:00')));
  }
  private get chartScale(){
    const rows=this.visibleHistory;
    const values=this.historyMode==='performance'
      ?rows.map(p=>p.performancePercent)
      :rows.flatMap(p=>[p.marketValue,p.netContributions]);
    const valid=values.filter((v):v is number=>v!==null&&Number.isFinite(v));
    if(!valid.length)return {min:0,max:1};
    const low=Math.min(...valid),high=Math.max(...valid);
    const span=Math.max(high-low,1),padding=span*.08;
    return {min:Math.floor(low-padding),max:Math.ceil(high+padding)};
  }
  get ticks():LineChartTick[]{
    const {min,max}=this.chartScale;
    return Array.from({length:5},(_,i)=>{
      const value=max-(max-min)*i/4;
      return {
        value:this.historyMode==='performance'?value.toFixed(1)+'%':
          new Intl.NumberFormat('it-IT',{style:'currency',currency:'EUR',maximumFractionDigits:0}).format(value),
        y:35+47.5*i
      };
    });
  }
  get series():LineChartSeries[]{
    const rows=this.visibleHistory,{min,max}=this.chartScale;
    const x=(i:number)=>rows.length===1?365:95+i*525/(rows.length-1);
    const y=(value:number)=>225-(value-min)*190/(max-min);
    const points=(value:(r:typeof rows[number])=>number|null)=>rows.map((r,i)=>{
      const n=value(r);
      return n===null||!Number.isFinite(n)?'':x(i).toFixed(1)+','+y(n).toFixed(1);
    }).filter(Boolean).join(' ');
    if(this.historyMode==='performance')return [{label:'Performance TWR (%)',color:'#2586d9',points:points(r=>r.performancePercent)}];
    return [
      {label:'Valore del portafoglio',color:'#2586d9',points:points(r=>r.marketValue)},
      {label:'Capitale netto investito',color:'#9ab2cf',points:points(r=>r.netContributions)}
    ];
  }
  startPortfolioDrag(i:number,event:DragEvent):void {
    this.openPortfolioMenu=null;
    this.draggedPortfolioIndex=i;
    this.portfolioDragSourceIndex=i;
    this.portfolioDragTargetIndex=i;
    this.portfolioDragOriginalOrder=[...this.portfolios];
    if(event.dataTransfer){
      event.dataTransfer.effectAllowed='move';
      event.dataTransfer.setData('text/plain',this.portfolios[i]?.id ?? '');
      const source=event.currentTarget as HTMLElement|null;
      if(source){
        const rect=source.getBoundingClientRect();
        this.portfolioDragPreviewOffset={x:event.clientX-rect.left,y:event.clientY-rect.top};

        const preview=source.cloneNode(true) as HTMLElement;
        preview.classList.remove('drag-source-empty','drag-shift-left','drag-shift-right');
        preview.classList.add('portfolio-pointer-drag-preview');
        preview.querySelectorAll('.portfolio-menu,.portfolio-dropdown').forEach(el=>el.remove());
        preview.style.cssText += `;position:fixed;left:${rect.left}px;top:${rect.top}px;width:${rect.width}px;height:${rect.height}px;box-sizing:border-box;opacity:1!important;visibility:visible!important;transform:none!important;background:#07121f!important;backdrop-filter:none!important;-webkit-backdrop-filter:none!important;z-index:2147483647;pointer-events:none;`;
        preview.querySelectorAll<HTMLElement>('*').forEach(el=>{el.style.opacity='1';el.style.visibility='visible';});
        document.body.appendChild(preview);
        this.portfolioDragPreview=preview;

        const transparent=document.createElement('canvas');
        transparent.width=1; transparent.height=1;
        event.dataTransfer.setDragImage(transparent,0,0);
      }
    }
  }
  movePortfolioDrag(event:DragEvent):void {
    if(!this.portfolioDragPreview || (event.clientX===0&&event.clientY===0))return;
    this.portfolioDragPreview.style.left=`${event.clientX-this.portfolioDragPreviewOffset.x}px`;
    this.portfolioDragPreview.style.top=`${event.clientY-this.portfolioDragPreviewOffset.y}px`;
  }
  allowPortfolioDrop(targetIndex:number,event:DragEvent):void {
    event.preventDefault();
    if(event.dataTransfer)event.dataTransfer.dropEffect='move';
    const from=this.portfolioDragSourceIndex;
    if(from===null)return;

    // Re-evaluate the target continuously from pointer position, including when
    // reversing direction during the same drag. Using only the last card entered
    // leaves a stale target after the first direction change.
    const card=event.currentTarget as HTMLElement|null;
    if(!card){this.portfolioDragTargetIndex=targetIndex;return;}
    const rect=card.getBoundingClientRect();
    const midpoint=rect.left+rect.width/2;
    let next=targetIndex;
    if(event.clientX<midpoint && targetIndex>from) next=targetIndex-1;
    if(event.clientX>=midpoint && targetIndex<from) next=targetIndex+1;
    this.portfolioDragTargetIndex=Math.max(0,Math.min(this.portfolios.length-1,next));
  }
  allowPortfolioStripDrop(event:DragEvent):void {
    if(this.draggedPortfolioIndex===null)return;
    event.preventDefault();
    if(event.dataTransfer)event.dataTransfer.dropEffect='move';
  }
  dropPortfolio(targetIndex:number|null,event:DragEvent):void {
    event.stopPropagation();
    if(targetIndex!==null)this.portfolioDragTargetIndex=targetIndex;
    event.preventDefault();
    if(this.draggedPortfolioIndex===null)return;
    const from=this.portfolioDragSourceIndex;
    const to=this.portfolioDragTargetIndex;
    if(from!==null && to!==null && from!==to){
      const selectedId=this.portfolios[this.selected]?.id;
      const reordered=[...this.portfolios];
      const [moved]=reordered.splice(from,1); reordered.splice(to,0,moved); this.portfolios=reordered;
      const selectedIndex=selectedId?this.portfolios.findIndex(p=>p.id===selectedId):-1; if(selectedIndex>=0)this.selected=selectedIndex;
    }
    // Disable preview transforms in the same frame as the DOM reorder. Otherwise,
    // on right-to-left drops the shifted sibling briefly keeps its translateX
    // after moving to its new grid cell and performs a second visible animation.
    this.suppressPortfolioDragTransitions=true;
    this.draggedPortfolioIndex=null;
    this.portfolioDragSourceIndex=null;
    this.portfolioDragTargetIndex=null;
    this.portfolioDragOriginalOrder=null;
    requestAnimationFrame(()=>requestAnimationFrame(()=>this.suppressPortfolioDragTransitions=false));
    this.api.updateRealPortfolioOrder(this.portfolios.map(p=>p.id)).subscribe({error:(error)=>{console.error('Errore salvataggio ordine portafogli',error);this.loadRealPortfolios();}});
  }
  endPortfolioDrag():void {
    this.portfolioDragPreview?.remove();
    this.portfolioDragPreview=null;
    // dragend fires after drop. A successful drop has already cleared the state;
    // otherwise this is a cancelled drag and only the visual preview is reset.
    this.draggedPortfolioIndex=null; this.portfolioDragSourceIndex=null; this.portfolioDragTargetIndex=null; this.portfolioDragOriginalOrder=null;
  }
  portfolioDragShift(i:number):'left'|'right'|null {
    const from=this.portfolioDragSourceIndex,to=this.portfolioDragTargetIndex;
    if(from===null||to===null||from===to||i===from)return null;
    if(to>from && i>from && i<=to)return 'left';
    if(to<from && i>=to && i<from)return 'right';
    return null;
  }
  portfolioColor(portfolio:Portfolio):string {
    const palette=['#2d91ff','#9b67ed','#21c7c7','#31d48d','#f9be48','#ff6b8a'];
    let hash=0; for(const ch of portfolio.id)hash=((hash<<5)-hash+ch.charCodeAt(0))|0;
    return palette[Math.abs(hash)%palette.length];
  }
  togglePortfolioMenu(event:MouseEvent,id:string):void { event.stopPropagation(); this.openPortfolioMenu=this.openPortfolioMenu===id?null:id; }
  choosePortfolioAction(event:MouseEvent,i:number):void { event.stopPropagation(); this.selectPortfolio(i); }
  openBuyOperation(event:MouseEvent,i:number):void { this.openOperation(event,i,'buy'); }
  openSellOperation(event:MouseEvent,i:number):void { this.openOperation(event,i,'sell'); }
  private openOperation(event:MouseEvent,i:number,type:'buy'|'sell'):void {
    event.stopPropagation(); this.selectPortfolio(i); this.openPortfolioMenu=null;
    this.operationPortfolio=this.portfolios[i] ?? null; this.operationType=type;
    this.operationEtfQuery=''; this.operationEtfResults=[]; this.operationEtf=null; this.ownedEtfs=[];
    this.operationDate=new Date().toISOString().slice(0,10); this.operationQuantity=''; this.operationUnitPrice='';
    if(type==='sell' && this.operationPortfolio) this.api.getRealPortfolioHoldings(this.operationPortfolio.id).subscribe({next:(res:any)=>this.ownedEtfs=Array.isArray(res?.data)?res.data:[],error:()=>this.ownedEtfs=[]});
  }
  cancelOperation():void { if(this.savingOperation)return; this.operationPortfolio=null; this.operationEtfResults=[]; }
  searchOperationEtf(value:string):void {
    this.operationEtfQuery=value; this.operationEtf=null;
    if(this.operationSearchTimer) clearTimeout(this.operationSearchTimer);
    if(value.trim().length<1){this.operationEtfResults=[];return;}
    if(this.operationType==='sell') {
      const q=value.trim().toLocaleLowerCase();
      this.operationEtfResults=this.ownedEtfs.filter((etf:any)=>[etf.nickname,etf.ticker,etf.name,etf.isin].some(v=>String(v??'').toLocaleLowerCase().includes(q)));
      return;
    }
    if(value.trim().length<3){this.operationEtfResults=[];return;}
    this.operationSearchTimer=setTimeout(()=>this.api.searchETF(value.trim()).subscribe({next:(res:any)=>this.operationEtfResults=Array.isArray(res?.data)?res.data:[],error:()=>this.operationEtfResults=[]}),250);
  }
  selectOperationEtf(etf:any):void {
    this.operationEtf=etf;
    this.operationEtfQuery=etf.nickname || etf.ticker || etf.name || etf.isin;
    this.operationEtfResults=[];
  }
  private parseDecimal(value:string|number|null|undefined):number {
    const raw=String(value ?? '').trim().replace(/\s/g,'');
    if(!raw)return NaN;
    const comma=raw.lastIndexOf(','), dot=raw.lastIndexOf('.');
    let normalized=raw;
    if(comma>=0 && dot>=0) normalized=comma>dot ? raw.replace(/\./g,'').replace(',','.') : raw.replace(/,/g,'');
    else if(comma>=0) normalized=raw.replace(',','.');
    const parsed=Number(normalized);
    return Number.isFinite(parsed)?parsed:NaN;
  }
  get operationFormValid():boolean {
    return !!this.operationPortfolio && !!this.operationEtf?.id && !!this.operationDate && this.parseDecimal(this.operationQuantity)>0 && this.parseDecimal(this.operationUnitPrice)>0 && !this.savingOperation;
  }
  get operationTotal():number {
    const q=this.parseDecimal(this.operationQuantity), p=this.parseDecimal(this.operationUnitPrice);
    return Number.isFinite(q)&&Number.isFinite(p)?q*p:0;
  }
  formatOperationTotal(value:number):string {
    return new Intl.NumberFormat('it-IT',{style:'currency',currency:'EUR',minimumFractionDigits:2,maximumFractionDigits:2}).format(Number.isFinite(value)?value:0);
  }
  private refreshPortfolioData(selectedId?:string):void {
    if(selectedId){
      const index=this.portfolios.findIndex(p=>p.id===selectedId);
      if(index>=0)this.selected=index;
      this.portfolioSelection.setSelectedPortfolio(selectedId);
    }
    this.loadOperations();
    this.loadMarketValues();
    this.loadHoldings();
    this.loadHistory();
  }
  private loadMarketValues():void {
    this.api.getRealPortfolioMarketValues().subscribe({
      next:(res:any)=>{
        const rows=Array.isArray(res?.data)?res.data:[];
        const byId=new Map(rows.map((row:any)=>[row.portfolioId,row]));
        this.portfolios=this.portfolios.map(p=>Object.assign({},p,byId.get(p.id)||{}));
      },
      error:(error)=>console.error('Errore caricamento valori portafogli',error)
    });
  }
  private loadHoldings():void {
    const portfolio=this.portfolios[this.selected];
    if(!portfolio){this.holdings=[];return;}
    this.api.getRealPortfolioHoldings(portfolio.id).subscribe({
      next:(res:any)=>{
        const rows=Array.isArray(res?.data)?res.data:[];
        const totalMarketValue=rows.reduce((sum:number,row:any)=>sum+(Number(row.marketValue)||0),0);
        const nf=new Intl.NumberFormat('it-IT',{minimumFractionDigits:0,maximumFractionDigits:8});
        const eur=new Intl.NumberFormat('it-IT',{style:'currency',currency:'EUR',minimumFractionDigits:2,maximumFractionDigits:2});
        this.holdings=rows.map((row:any)=>{
          const gain=Number(row.gainLoss)||0;
          const gainPct=Number(row.gainLossPercent)||0;
          const marketValue=Number(row.marketValue)||0;
          const sign=gain>0?'+ ':gain<0?'- ':'';
          return {
            name:row.nickname||row.name||row.ticker||row.isin,
            nickname:row.nickname||row.ticker||row.name||row.isin,
            ticker:row.ticker||'—',
            assetClass:row.assetClass||'',
            qty:nf.format(Number(row.quantity)||0),
            avg:eur.format(Number(row.averageCost)||0),
            price:row.currentPrice==null?'—':eur.format(Number(row.currentPrice)),
            value:row.marketValue==null?'—':eur.format(marketValue),
            marketValue:row.marketValue==null?null:marketValue,
            gain:row.gainLoss==null?'—':`${sign}${eur.format(Math.abs(gain))}  (${this.formatSignedPercent(gainPct)})`,
            weight:row.marketValue==null||totalMarketValue<=0?'—':this.formatSignedPercent(marketValue/totalMarketValue*100).replace('+',''),
            tone:gain>0?'positive':gain<0?'negative':'neutral'
          } as Holding;
        });
      },
      error:()=>this.holdings=[]
    });
  }
  formatCurrencyTrailing(value:number):string { return `${new Intl.NumberFormat('it-IT',{minimumFractionDigits:2,maximumFractionDigits:2}).format(Number(value)||0)} €`; }
  formatCurrency(value:number):string { return new Intl.NumberFormat('it-IT',{style:'currency',currency:'EUR',minimumFractionDigits:2,maximumFractionDigits:2}).format(Number(value)||0); }
  formatSignedPercent(value:number):string { const n=Number(value)||0; return `${n>0?'+':''}${new Intl.NumberFormat('it-IT',{minimumFractionDigits:1,maximumFractionDigits:1}).format(n)}%`; }
  valueTone(value:number):string { return value>0?'positive':value<0?'negative':'neutral'; }
  portfolioDisplayName(p:Portfolio):string {
    if(!p.quotationDate)return p.name;
    const today=new Date().toISOString().slice(0,10);
    if(p.quotationDate===today)return p.name;
    return `${p.name} (${new Intl.DateTimeFormat('it-IT',{day:'numeric',month:'long',year:'numeric'}).format(new Date(p.quotationDate+'T12:00:00'))})`;
  }
  private loadOperations():void {
    const portfolio=this.portfolios[this.selected]; if(!portfolio){this.operations=[];return;}
    this.api.getLatestRealPortfolioOperations(portfolio.id).subscribe({next:(res:any)=>{
      const rows=Array.isArray(res?.data)?res.data:[];
      const nf=new Intl.NumberFormat('it-IT',{minimumFractionDigits:0,maximumFractionDigits:8});
      const eur=new Intl.NumberFormat('it-IT',{style:'currency',currency:'EUR',minimumFractionDigits:2,maximumFractionDigits:2});
      const df=new Intl.DateTimeFormat('it-IT',{day:'numeric',month:'short',year:'numeric'});
      this.operations=rows.map((o:any)=>{
        const q=this.parseDecimal(o.quantity),p=this.parseDecimal(o.unitPrice);
        if(o.operationType==='tax') return {date:df.format(new Date(String(o.operationDate)+'T12:00:00')),type:'Ritenuta' as const,isin:'—',etf:'Ritenuta fiscale 26%',qty:'—',price:'—',total:eur.format(Number(o.total ?? -p))};
        return {date:df.format(new Date(String(o.operationDate)+'T12:00:00')),type:o.operationType==='sell'?'Vendita' as const:'Acquisto' as const,isin:o.etf?.isin||'',etf:o.etf?.nickname||o.etf?.name||o.etf?.ticker||'',qty:nf.format(q),price:eur.format(p),total:eur.format(q*p)};
      });
    },error:()=>this.operations=[]});
  }
  insertOperation():void {
    if(!this.operationFormValid || !this.operationPortfolio)return;
    this.savingOperation=true;
    this.api.createRealPortfolioOperation(this.operationPortfolio.id,{operationType:this.operationType,etfId:this.operationEtf.id,operationDate:this.operationDate,quantity:this.parseDecimal(this.operationQuantity),unitPrice:this.parseDecimal(this.operationUnitPrice)}).subscribe({
      next:()=>{
        const selectedId=this.portfolios[this.selected]?.id;
        this.savingOperation=false;this.operationPortfolio=null;this.operationEtfResults=[];
        this.refreshPortfolioData(selectedId);
      },
      error:(error)=>{this.savingOperation=false;console.error('Errore inserimento operazione',error);}
    });
  }
  requestDeletePortfolio(event:MouseEvent,portfolio:Portfolio):void { event.stopPropagation(); this.openPortfolioMenu=null; this.portfolioPendingDelete=portfolio; }
  keepPortfolio():void { if(this.deletingPortfolio)return; this.portfolioPendingDelete=null; }
  confirmDeletePortfolio():void {
    const portfolio=this.portfolioPendingDelete;
    if(!portfolio||this.deletingPortfolio)return;
    this.deletingPortfolio=true;
    this.api.deleteRealPortfolio(portfolio.id).subscribe({
      next:()=>{
        const removedIndex=this.portfolios.findIndex(item=>item.id===portfolio.id);
        this.portfolios=this.portfolios.filter(item=>item.id!==portfolio.id);
        if(this.portfolios.length===0)this.selected=0;
        else if(this.selected>=this.portfolios.length)this.selected=this.portfolios.length-1;
        else if(removedIndex>=0&&removedIndex<this.selected)this.selected--;
        this.deletingPortfolio=false;
        this.portfolioPendingDelete=null;
        this.portfolioSelection.loadPortfolios();
      },
      error:(error)=>{this.deletingPortfolio=false; console.error('Errore eliminazione portafoglio', error);}
    });
  }
  @HostListener('document:click') closePortfolioMenu():void { this.openPortfolioMenu=null; }
  selectPortfolio(i:number){
    this.selected=i;
    this.openPortfolioMenu=null;
    const portfolio=this.portfolios[i];
    this.portfolioSelection.setSelectedPortfolio(portfolio?.id ?? null);
    this.loadOperations();
    this.loadHoldings();
    this.loadHistory();
  }
}