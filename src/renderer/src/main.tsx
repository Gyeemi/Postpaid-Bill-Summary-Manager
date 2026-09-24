import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './styles.css'
import { AppProvider } from './state/store'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <AppProvider>
      <App />
    </AppProvider>
  </React.StrictMode>
)
