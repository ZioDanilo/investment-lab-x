import { CommonModule } from '@angular/common';
import { Component, HostListener, OnInit, effect, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { UiCardComponent } from '../../shared/components/ui-card/ui-card.component';
import { UiButtonComponent } from '../../shared/components/ui-button/ui-button.component';
import { LineChartComponent, LineChartSeries, LineChartTick } from '../../shared/components/line-chart/line-chart.component';
import { ChartLegendComponent, ChartLegendItem } from '../../shared/components/chart-legend/chart-legend.component';
import { ApiService } from '../../core/api/api.service';
import { PortfolioSelectionService } from '../../core/services/portfolio-selection.service';

interface Portfolio { id:string; name:string; description?:string|null; status:string; marketValue?:number; investedCapital?:number; gainLoss?:number; gainLossPercent?:number; quotationDate?:string|null; }
interface Holding { name:string; nickname:string; ticker:string; assetClass:string; qty:string; avg:string; price:string; value:string; marketValue:number|null; gain:string; weight:string; tone:'positive'|'negative'|'neutral'; }
interface Operation { date:string; type:'Acquisto'|'Vendita'|'Ritenuta'; isin:string; etf:string; qty:string; price:string; total:string; }

@Component({
  selector:'app-real-portfolios-page',
  standalone:true,
  imports:[CommonModule,FormsModule,RouterLink,UiCardComponent,UiButtonComponent,LineChartComponent,ChartLegendComponent],
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
  runHeaderAction():void {
    const portfolio=this.portfolios[this.selected];
    if(!portfolio || this.quotationRefreshRunning)return;

    // The refresh POST must be the first request. Previously a preliminary GET
    // /holdings could be satisfied with HTTP 304 and prevent the refresh chain
    // from reaching EODHD in some browser/cache paths.
    this.quotationRefreshRunning=true;
    this.headerActionProgress=1;
    this.startQuotationProgress(Math.max(1,this.holdings.length));

    this.api.refreshRealPortfolioQuotations(portfolio.id).subscribe({
      next:()=>{
        this.loadMarketValues();
        this.loadHoldings();
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
        if (index >= 0 && index !== this.selected) this.selected = index;
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
        if (!selectedId && this.portfolios.length) this.portfolioSelection.setSelectedPortfolio(this.portfolios[0].id);
        else if (!this.portfolios.length && !selectedId) this.portfolioSelection.setSelectedPortfolio(null);
        this.loadOperations();
        this.loadMarketValues();
        this.loadHoldings();
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
    ['Rendimento annuo (TWR)','+8,1%','','positive'],
    ['Volatilità annua','11,3%','',''],
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
  compositionTooltip={x:0,y:0};
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
    const distance=2.8;
    const dx=Math.cos(radians)*distance;
    const dy=Math.sin(radians)*distance;
    return `translate(${dx.toFixed(2)} ${dy.toFixed(2)}) scale(1.06)`;
  }
  hoverComposition(index:number,event:MouseEvent):void {
    this.compositionHoverIndex=index;
    this.moveCompositionTooltip(event);
  }
  moveCompositionTooltip(event:MouseEvent):void {
    this.compositionTooltip={x:event.clientX+12,y:event.clientY-12};
  }
  leaveComposition():void { this.compositionHoverIndex=null; }
  operations:Operation[]=[];
  readonly stats=[['Rendimento totale','+12,4%','positive'],['Rendimento annuo (TWR)','+8,1%','positive'],['Volatilità annua','11,3%',''],['Sharpe ratio (rf 2%)','0,54',''],['Massimo drawdown','-7,8%','negative'],['Mese migliore','+4,9%','positive'],['Mese peggiore','-4,1%','negative'],['Mesi positivi','18 (66%)','']];
  readonly legend:ChartLegendItem[]=[{label:'Valore di mercato',color:'#2d91ff'},{label:'Capitale investito',color:'#9ab2cf'}];
  readonly series:LineChartSeries[]=[
    {label:'Valore di mercato',color:'#2d91ff',points:'52,205 95,193 140,181 188,174 235,158 282,166 330,145 378,132 425,119 472,111 520,116 568,100 620,94'},
    {label:'Capitale investito',color:'#9ab2cf',points:'52,216 95,207 140,199 188,191 235,182 282,174 330,164 378,154 425,145 472,137 520,131 568,124 620,118'}
  ];
  readonly ticks:LineChartTick[]=[{value:'€ 30.000',y:30},{value:'€ 25.000',y:70},{value:'€ 20.000',y:110},{value:'€ 15.000',y:150},{value:'€ 10.000',y:190},{value:'€ 5.000',y:230}];
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
  }
}