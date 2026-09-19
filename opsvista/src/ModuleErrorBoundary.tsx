import { Component, type ErrorInfo, type ReactNode } from 'react';

type Props={children:ReactNode;moduleName:string;onOpenOverview:()=>void};
type State={error?:Error};

export default class ModuleErrorBoundary extends Component<Props,State>{
  state:State={};

  static getDerivedStateFromError(error:Error):State{return {error};}

  componentDidCatch(error:Error,info:ErrorInfo){
    console.error(`OpsVista could not render ${this.props.moduleName}`,error,info);
  }

  private retry=()=>window.location.reload();

  render(){
    if(!this.state.error)return this.props.children;
    return <section className="panel" role="alert">
      <div className="panel-header">
        <div><h2>{this.props.moduleName} no pudo abrirse</h2><p>Tu sesión y tus datos siguen seguros. Puedes recargar esta sección o continuar en Resumen.</p></div>
        <span className="count-pill">RECUPERACIÓN</span>
      </div>
      <div style={{display:'flex',gap:10,flexWrap:'wrap',padding:20}}>
        <button type="button" onClick={this.retry} style={{border:0,borderRadius:10,padding:'11px 16px',background:'#0f172a',color:'#fff',fontWeight:800,cursor:'pointer'}}>Recargar sección</button>
        <button type="button" onClick={this.props.onOpenOverview} style={{border:'1px solid #cbd5e1',borderRadius:10,padding:'11px 16px',background:'#fff',color:'#334155',fontWeight:800,cursor:'pointer'}}>Abrir Resumen</button>
      </div>
    </section>;
  }
}
