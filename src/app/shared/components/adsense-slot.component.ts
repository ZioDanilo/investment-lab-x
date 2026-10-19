import { AfterViewInit, Component, ElementRef, Input, OnDestroy, ViewChild } from '@angular/core';

declare global {
  interface Window { adsbygoogle?: Array<Record<string, never>>; }
}

@Component({
  selector: 'app-adsense-slot',
  standalone: true,
  template: `<div class="razer-ad" aria-label="Pubblicità">
    <span class="razer-ad__caption">PUBBLICITÀ</span>
    <ins #ad class="adsbygoogle" style="display:block;width:100%;height:100%"
      data-ad-client="ca-pub-1502115561193860"
      [attr.data-ad-slot]="slot"
      data-ad-format="auto"
      data-full-width-responsive="true"></ins>
  </div>`,
  styles: [`
    :host { display:block; width:100%; height:100%; min-height:0; }
    .razer-ad { position:relative; box-sizing:border-box; width:100%; height:100%; min-height:120px; overflow:hidden; }
    .razer-ad__caption { position:absolute; top:0; left:0; right:0; text-align:center; font-size:9px; letter-spacing:.12em; color:#8a9fb4; pointer-events:none; }
    .adsbygoogle { box-sizing:border-box; padding-top:14px; }
  `]
})
export class AdsenseSlotComponent implements AfterViewInit, OnDestroy {
  @Input({ required: true }) slot = '';
  @ViewChild('ad', { static: true }) ad!: ElementRef<HTMLElement>;
  private observer?: IntersectionObserver;
  private loaded = false;

  ngAfterViewInit(): void {
    if (!/^\\d+$/.test(this.slot)) return;
    this.observer = new IntersectionObserver(entries => {
      if (!entries.some(entry => entry.isIntersecting) || this.loaded) return;
      // AdSense requires a measurable container. Retry when responsive layout is ready.
      if (this.ad.nativeElement.getBoundingClientRect().width < 120) return;
      this.loaded = true;
      this.observer?.disconnect();
      try { (window.adsbygoogle = window.adsbygoogle || []).push({}); }
      catch (error) { console.warn('AdSense slot not initialized', this.slot, error); }
    }, { threshold: 0 });
    this.observer.observe(this.ad.nativeElement);
  }

  ngOnDestroy(): void { this.observer?.disconnect(); }
}
