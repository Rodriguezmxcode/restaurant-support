import { Component, type ErrorInfo, type ReactNode } from 'react';

type Props = { children: ReactNode };
type State = { error?: Error };

export default class AppErrorBoundary extends Component<Props, State> {
  state: State = {};

  static getDerivedStateFromError(error: Error): State { return { error }; }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('OpsVista could not render the authenticated application', error, info);
  }

  private recover = () => {
    try {
      window.localStorage.removeItem('opsvista-section');
      window.sessionStorage.removeItem('opsvista-section');
    } catch { /* Storage may be blocked by the browser. */ }
    window.location.assign('/');
  };

  render() {
    if (!this.state.error) return this.props.children;
    return <main style={{minHeight:'100vh',display:'grid',placeItems:'center',padding:24,background:'#f8fafc',fontFamily:'Inter,system-ui,sans-serif'}}>
      <section style={{maxWidth:560,padding:28,border:'1px solid #e2e8f0',borderRadius:16,background:'#fff',boxShadow:'0 18px 50px rgba(15,23,42,.10)'}}>
        <div style={{fontSize:12,fontWeight:800,letterSpacing:'.12em',color:'#64748b'}}>OPSVISTA · RECUPERACIÓN SEGURA</div>
        <h1 style={{margin:'10px 0 8px',fontSize:28,color:'#0f172a'}}>La vista necesita reiniciarse</h1>
        <p style={{margin:'0 0 20px',lineHeight:1.6,color:'#475569'}}>Tu sesión y tus datos siguen seguros. Reiniciaremos únicamente la última pantalla guardada para abrir el Resumen.</p>
        <button onClick={this.recover} style={{border:0,borderRadius:10,padding:'11px 16px',background:'#0f172a',color:'#fff',fontWeight:800,cursor:'pointer'}}>Volver a OpsVista</button>
      </section>
    </main>;
  }
}
