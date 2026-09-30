import { CommonModule } from '@angular/common';
import { Component, OnInit, signal, computed } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { UiCardComponent } from '../../shared/components/ui-card/ui-card.component';
import { UiButtonComponent } from '../../shared/components/ui-button/ui-button.component';
import { LineChartComponent, LineChartSeries, LineChartTick } from '../../shared/components/line-chart/line-chart.component';
import { ChartLegendComponent, ChartLegendItem } from '../../shared/components/chart-legend/chart-legend.component';
import { ApiService } from '../../core/api/api.service';
import { DropdownComponent, DropdownOption } from '../../shared/components/dropdown/dropdown.component';

interface Portfolio { id:string; name:string; description?:string|null; status:string; }
interface Etf { id:string; isin:string; name:string; description?:string; ticker?:string; }
interface Holding { name:string; ticker:string; qty:string; avg:string; value:string; gain:string; weight:string; tone:'positive'|'negative'; }
interface Operation { date:string; type:'Acquisto'|'Vendita'; ticker:string; qty:string; price:string; total:string; }

@Component({
  selector:'app-real-portfolios-page',
  standalone:true,
  imports:[CommonModule,FormsModule,RouterLink,UiCardComponent,UiButtonComponent,LineChartComponent,ChartLegendComponent,DropdownComponent],
  templateUrl:'./real-portfolios-page.component.html',
  styleUrls:['./real-portfolios-page.component.css']
})
export class RealPortfoliosPageComponent implements OnInit {
  portfolios:Portfolio[]=[];
  selected=0;
  loadingPortfolios=true;
  showCreateDialog=signal(false);
  portfolioName=signal('');
  searchQuery=signal('');
  searchResults=signal<Etf[]>([]);
  selectedEtfs=signal<Etf[]>([]);
  searchLoading=signal(false);
  creating=false;
  searchDropdownOptions=computed<DropdownOption[]>(()=>this.searchResults().map(etf=>({value:etf.id,label:etf.name,description:etf.isin})));

  constructor(private readonly api:ApiService) {}

  ngOnInit():void {
    this.api.getRealPortfolios().subscribe({
      next:(response:any)=>{ this.portfolios=Array.isArray(response?.data)?response.data:[]; this.selected=0; this.loadingPortfolios=false; },
      error:()=>{ this.portfolios=[]; this.loadingPortfolios=false; }
    });
  }

  get hasSelectedPortfolio():boolean { return this.portfolios.length>0 && !!this.portfolios[this.selected]; }

  openCreatePortfolio():void { this.portfolioName.set(''); this.searchQuery.set(''); this.searchResults.set([]); this.selectedEtfs.set([]); this.showCreateDialog.set(true); }
  discardCreatePortfolio():void { this.showCreateDialog.set(false); this.portfolioName.set(''); this.searchQuery.set(''); this.searchResults.set([]); this.selectedEtfs.set([]); }
  onSearchChange(query:string):void {
    this.searchQuery.set(query);
    if(query.length<3){this.searchResults.set([]);return;}
    this.searchLoading.set(true);
    this.api.searchETF(query).subscribe({
      next:(res:any)=>{const ids=new Set(this.selectedEtfs().map(x=>x.id));this.searchResults.set((res?.data||[]).filter((x:Etf)=>!ids.has(x.id)));this.searchLoading.set(false);},
      error:()=>{this.searchResults.set([]);this.searchLoading.set(false);}
    });
  }
  onSearchResultSelected(id:string):void {
    const etf=this.searchResults().find(x=>x.id===id); if(!etf)return;
    this.selectedEtfs.update(items=>[...items,etf]); this.searchQuery.set(''); this.searchResults.set([]);
  }
  removeSelectedEtf(id:string):void { this.selectedEtfs.update(items=>items.filter(x=>x.id!==id)); }
  createPortfolio():void {
    const name=this.portfolioName().trim(); if(!name||this.creating)return;
    this.creating=true;
    this.api.createRealPortfolio({name}).subscribe({
      next:(res:any)=>{if(res?.data)this.portfolios=[...this.portfolios,res.data];this.selected=Math.max(0,this.portfolios.length-1);this.creating=false;this.discardCreatePortfolio();},
      error:()=>{this.creating=false;}
    });
  }
  readonly kpis=[
    ['Valore di mercato','€ 24.523','+ € 2.701  (+12,4%)','positive'],
    ['Capitale investito','€ 21.822','',''],
    ['Gain/Loss','+ € 2.701','+12,4%','positive'],
    ['Rendimento annuo (TWR)','+8,1%','','positive'],
    ['Volatilità annua','11,3%','',''],
    ['Numero ETF','5','','']
  ];
  readonly holdings:Holding[]=[
    {name:'Vanguard FTSE All-World UCITS ETF',ticker:'VWCE',qty:'42,000',avg:'€ 78,23',value:'€ 9.367',gain:'+ € 1.421  +17,8%',weight:'38,2%',tone:'positive'},
    {name:'iShares Core MSCI EM IMI UCITS ETF',ticker:'EIMI',qty:'120,000',avg:'€ 32,11',value:'€ 6.009',gain:'+ € 623  +11,6%',weight:'24,5%',tone:'positive'},
    {name:'iShares Core Global Aggregate Bond UCITS ETF',ticker:'AGGH',qty:'85,000',avg:'€ 47,20',value:'€ 4.438',gain:'+ € 198  +4,7%',weight:'18,1%',tone:'positive'},
    {name:'iShares Core EUR Corporate Bond UCITS ETF',ticker:'IUSN',qty:'60,000',avg:'€ 46,11',value:'€ 2.797',gain:'+ € 156  +5,9%',weight:'11,4%',tone:'positive'},
    {name:'iShares Core S&P 500 UCITS ETF',ticker:'CSPX',qty:'15,000',avg:'€ 410,23',value:'€ 1.912',gain:'+ € 303  +18,8%',weight:'7,8%',tone:'positive'}
  ];
  readonly operations:Operation[]=[
    {date:'12 gen 2025',type:'Acquisto',ticker:'VWCE',qty:'5,000',price:'€ 92,40',total:'€ 462,00'},
    {date:'3 dic 2024',type:'Acquisto',ticker:'EIMI',qty:'10,000',price:'€ 34,21',total:'€ 342,10'},
    {date:'15 ott 2024',type:'Vendita',ticker:'CSPX',qty:'5,000',price:'€ 428,50',total:'€ 2.142,50'},
    {date:'8 set 2024',type:'Acquisto',ticker:'AGGH',qty:'10,000',price:'€ 46,80',total:'€ 468,00'},
    {date:'11 lug 2024',type:'Acquisto',ticker:'IUSN',qty:'15,000',price:'€ 44,90',total:'€ 673,50'}
  ];
  readonly stats=[['Rendimento totale','+12,4%','positive'],['Rendimento annuo (TWR)','+8,1%','positive'],['Volatilità annua','11,3%',''],['Sharpe ratio (rf 2%)','0,54',''],['Massimo drawdown','-7,8%','negative'],['Mese migliore','+4,9%','positive'],['Mese peggiore','-4,1%','negative'],['Mesi positivi','18 (66%)','']];
  readonly legend:ChartLegendItem[]=[{label:'Valore di mercato',color:'#2d91ff'},{label:'Capitale investito',color:'#9ab2cf'}];
  readonly series:LineChartSeries[]=[
    {label:'Valore di mercato',color:'#2d91ff',points:'52,205 95,193 140,181 188,174 235,158 282,166 330,145 378,132 425,119 472,111 520,116 568,100 620,94'},
    {label:'Capitale investito',color:'#9ab2cf',points:'52,216 95,207 140,199 188,191 235,182 282,174 330,164 378,154 425,145 472,137 520,131 568,124 620,118'}
  ];
  readonly ticks:LineChartTick[]=[{value:'€ 30.000',y:30},{value:'€ 25.000',y:70},{value:'€ 20.000',y:110},{value:'€ 15.000',y:150},{value:'€ 10.000',y:190},{value:'€ 5.000',y:230}];
  selectPortfolio(i:number){this.selected=i;}
}