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

interface Portfolio { id:string; name:string; description?:string|null; status:string; marketValue?:number; totalValue?:number; gainLoss?:number; gainLossPercent?:number; quotationDate?:string|null; }
interface Holding { name:string; ticker:string; qty:string; avg:string; value:string; gain:string; weight:string; tone:'positive'|'negative'; }
interface Operation { date:string; type:'Acquisto'|'Vendita'; isin:string; etf:string; qty:string; price:string; total:string; }

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
    this.quotationRefreshRunning=true;
    this.headerActionProgress=1;
    this.api.getRealPortfolioHoldings(portfolio.id).subscribe({
      next:(holdingsRes:any)=>{
        const etfCount=Math.max(1,Array.isArray(holdingsRes?.data)?holdingsRes.data.length:1);
        this.startQuotationProgress(etfCount);
        this.api.refreshRealPortfolioQuotations(portfolio.id).subscribe({
          next:()=>{this.loadMarketValues();this.finishQuotationProgress();},
          error:(error)=>{this.resetQuotationProgress();console.error('Errore aggiornamento quotazioni portafoglio',error);}
        });
      },
      error:()=>{
        this.startQuotationProgress(1);
        this.api.refreshRealPortfolioQuotations(portfolio.id).subscribe({
          next:()=>this.finishQuotationProgress(),
          error:(error)=>{this.resetQuotationProgress();console.error('Errore aggiornamento quotazioni portafoglio',error);}
        });
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

  constructor(private readonly api:ApiService, private readonly portfolioSelection:PortfolioSelectionService) {
    effect(() => {
      const refreshVersion = this.portfolioSelection.refreshVersion();
      if (this.initialized && refreshVersion > 0) this.loadRealPortfolios();

      const realOptions = this.portfolioSelection.portfolioOptions().filter((option) => option.tipo === 'reale');
      if (realOptions.length && this.portfolios.length) {
        const byId = new Map(this.portfolios.map((portfolio) => [portfolio.id, portfolio]));
        const ordered = realOptions.map((option) => byId.get(option.id)).filter((portfolio): portfolio is Portfolio => !!portfolio);
        if (ordered.length === this.portfolios.length && ordered.some((portfolio, index) => portfolio.id !== this.portfolios[index]?.id)) {
          this.portfolios = ordered;
        }
      }

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
      },
      error:()=>{ this.portfolios=[]; this.loadingPortfolios=false; }
    });
  }

  get hasSelectedPortfolio():boolean { return this.portfolios.length>0 && !!this.portfolios[this.selected]; }

  openCreatePortfolio():void { this.portfolioName.set(''); this.portfolioDescription.set(''); this.showCreateDialog.set(true); }
  discardCreatePortfolio():void { this.showCreateDialog.set(false); this.portfolioName.set(''); this.portfolioDescription.set(''); }
  createPortfolio():void {
    const name=this.portfolioName().trim(); if(!name||this.creating||this.portfolioNameUnavailable)return;
    this.creating=true;
    this.api.createRealPortfolio({name, description:this.portfolioDescription().trim() || null}).subscribe({
      next:(res:any)=>{if(res?.data)this.portfolios=[...this.portfolios,res.data];this.selected=Math.max(0,this.portfolios.length-1);this.creating=false;this.discardCreatePortfolio();this.portfolioSelection.loadPortfolios();},
      error:()=>{this.creating=false;}
    });
  }
  get kpis(){
    const p=this.portfolios[this.selected];
    const value=p?.totalValue ?? 0, gain=p?.gainLoss ?? 0, pct=p?.gainLossPercent ?? 0;
    const tone=this.valueTone(gain), sign=gain>0?'+ ':gain<0?'- ':'';
    return [
    ['Valore di mercato',this.formatCurrency(value),`${sign}${this.formatCurrency(Math.abs(gain))}  (${this.formatSignedPercent(pct)})`,tone],
    ['Capitale investito','€ 21.822','',''],
    ['Gain/Loss','+ € 2.701','+12,4%','positive'],
    ['Rendimento annuo (TWR)','+8,1%','','positive'],
    ['Volatilità annua','11,3%','',''],
    ['Numero ETF','5','','']
  ];
  }
  readonly holdings:Holding[]=[
    {name:'Vanguard FTSE All-World UCITS ETF',ticker:'VWCE',qty:'42,000',avg:'€ 78,23',value:'€ 9.367',gain:'+ € 1.421  +17,8%',weight:'38,2%',tone:'positive'},
    {name:'iShares Core MSCI EM IMI UCITS ETF',ticker:'EIMI',qty:'120,000',avg:'€ 32,11',value:'€ 6.009',gain:'+ € 623  +11,6%',weight:'24,5%',tone:'positive'},
    {name:'iShares Core Global Aggregate Bond UCITS ETF',ticker:'AGGH',qty:'85,000',avg:'€ 47,20',value:'€ 4.438',gain:'+ € 198  +4,7%',weight:'18,1%',tone:'positive'},
    {name:'iShares Core EUR Corporate Bond UCITS ETF',ticker:'IUSN',qty:'60,000',avg:'€ 46,11',value:'€ 2.797',gain:'+ € 156  +5,9%',weight:'11,4%',tone:'positive'},
    {name:'iShares Core S&P 500 UCITS ETF',ticker:'CSPX',qty:'15,000',avg:'€ 410,23',value:'€ 1.912',gain:'+ € 303  +18,8%',weight:'7,8%',tone:'positive'}
  ];
  operations:Operation[]=[];
  readonly stats=[['Rendimento totale','+12,4%','positive'],['Rendimento annuo (TWR)','+8,1%','positive'],['Volatilità annua','11,3%',''],['Sharpe ratio (rf 2%)','0,54',''],['Massimo drawdown','-7,8%','negative'],['Mese migliore','+4,9%','positive'],['Mese peggiore','-4,1%','negative'],['Mesi positivi','18 (66%)','']];
  readonly legend:ChartLegendItem[]=[{label:'Valore di mercato',color:'#2d91ff'},{label:'Capitale investito',color:'#9ab2cf'}];
  readonly series:LineChartSeries[]=[
    {label:'Valore di mercato',color:'#2d91ff',points:'52,205 95,193 140,181 188,174 235,158 282,166 330,145 378,132 425,119 472,111 520,116 568,100 620,94'},
    {label:'Capitale investito',color:'#9ab2cf',points:'52,216 95,207 140,199 188,191 235,182 282,174 330,164 378,154 425,145 472,137 520,131 568,124 620,118'}
  ];
  readonly ticks:LineChartTick[]=[{value:'€ 30.000',y:30},{value:'€ 25.000',y:70},{value:'€ 20.000',y:110},{value:'€ 15.000',y:150},{value:'€ 10.000',y:190},{value:'€ 5.000',y:230}];
  portfolioColor(i:number):string { return ['#2d91ff','#9b67ed','#21c7c7','#31d48d','#f9be48','#ff6b8a'][i%6]; }
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
        return {date:df.format(new Date(String(o.operationDate)+'T12:00:00')),type:o.operationType==='sell'?'Vendita':'Acquisto',isin:o.etf?.isin||'',etf:o.etf?.nickname||o.etf?.name||o.etf?.ticker||'',qty:nf.format(q),price:eur.format(p),total:eur.format(q*p)};
      });
    },error:()=>this.operations=[]});
  }
  insertOperation():void {
    if(!this.operationFormValid || !this.operationPortfolio)return;
    this.savingOperation=true;
    this.api.createRealPortfolioOperation(this.operationPortfolio.id,{operationType:this.operationType,etfId:this.operationEtf.id,operationDate:this.operationDate,quantity:this.parseDecimal(this.operationQuantity),unitPrice:this.parseDecimal(this.operationUnitPrice)}).subscribe({
      next:()=>{this.savingOperation=false;this.operationPortfolio=null;this.operationEtfResults=[];this.loadOperations();},
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
  }
}