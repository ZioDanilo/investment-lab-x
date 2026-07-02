# Backend API Integration

## Configuration

### Environment Setup

Development (local backend):
```typescript
// src/environments/environment.ts
export const environment = {
  production: false,
  apiUrl: 'http://localhost:3000/api'
};
```

Production:
```typescript
// src/environments/environment.prod.ts
export const environment = {
  production: true,
  apiUrl: 'https://api.investment-lab.com/api'
};
```

## API Service

### Usage in Components

```typescript
import { ApiService } from './core/api/api.service';

export class MyComponent {
  constructor(private api: ApiService) {}

  loadPortfolios() {
    this.api.getPortfolios().subscribe(response => {
      console.log(response.data);
    });
  }
}
```

## Portfolio State Service

Updated to support backend integration:

- `initializeFromApi()`: Fetches ETFs from backend on service creation
- `savePortfolioToBackend(name)`: Saves current portfolio to backend
- Falls back to local data if backend is unavailable

## Backend URL

- **Development**: `http://localhost:3000/api`
- **Production**: Configure via `environment.prod.ts`

## Running the Stack

### Backend (Express + PostgreSQL)
```bash
cd investment-lab-service
npm run dev
# Runs on http://localhost:3000
```

### Frontend (Angular)
```bash
cd investment-lab-x-web-vscode
ng serve
# Runs on http://localhost:4200
```

Both services will communicate via HTTP with CORS enabled.
