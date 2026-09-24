import { Component, inject } from '@angular/core';
import { Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { PortfolioSelectorComponent } from './shared/portfolio-selector/portfolio-selector.component';

@Component({
  selector: 'app-shell',
  standalone: true,
  imports: [RouterOutlet, RouterLink, RouterLinkActive, PortfolioSelectorComponent],
  templateUrl: './app-shell.component.html',
  styleUrls: ['./app-shell.component.css']
})
export class AppShellComponent {
  private readonly router = inject(Router);

  goHome(event: MouseEvent): void {
    event.preventDefault();

    if (this.router.url === '/home') {
      window.location.reload();
      return;
    }

    void this.router.navigateByUrl('/home');
  }
}
