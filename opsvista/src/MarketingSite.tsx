import { useEffect, useState } from 'react';

type Lang='en'|'es';

const copy={
  en:{
    navFeatures:'Features',navHow:'How it works',navPricing:'Pricing',login:'Client Login',demo:'Book a Demo',
    kicker:'Restaurant operations intelligence for single & multi-location teams',
    hero:'See your entire restaurant operation in one place.',
    heroSub:'OpsVista connects sales, labor, purchasing, costs, reviews and execution so restaurant teams can catch problems earlier, protect margin and act faster.',
    heroCta:'See OpsVista in action',heroAlt:'Explore features',
    proof1:'Single or multi-location',proof2:'English & Spanish',proof3:'Role-based access',
    priceEyebrow:'MARGIN PROTECTION',priceTitle:'Catch supplier price increases before they quietly eat your margin.',
    priceSub:'Price Watch turns purchasing history into actionable cost intelligence across products, suppliers and locations.',
    coreEyebrow:'CORE INTELLIGENCE',coreTitle:'One operating system. Six high-value views.',
    coreSub:'Move from scattered reports to a connected operating picture your team can actually use.',
    moreEyebrow:'MORE OPSVISTA',moreTitle:'More than dashboards. Built around restaurant execution.',
    priceLabel:'Simple pricing',priceHeading:'Start with one location. Scale when you are ready.',
    priceText:'OpsVista is designed for independent restaurants, growing groups and multi-unit operators.',
    per:' / location / month',tax:'Plus applicable taxes. Feature availability may depend on connected systems and data access.',
    final:'Your restaurant data should tell you what needs attention.',
    finalSub:'Tell us how many locations you operate and which systems you use. We’ll show you how OpsVista can bring the operation into one decision-ready view.',
    finalCta:'Book an OpsVista Demo'
  },
  es:{
    navFeatures:'Funciones',navHow:'Cómo funciona',navPricing:'Precio',login:'Acceso Cliente',demo:'Solicitar Demo',
    kicker:'Inteligencia operativa para restaurantes de una o múltiples ubicaciones',
    hero:'Ve toda la operación de tus restaurantes en un solo lugar.',
    heroSub:'OpsVista conecta ventas, labor, compras, costos, reseñas y ejecución para detectar problemas antes, proteger el margen y actuar más rápido.',
    heroCta:'Ver OpsVista en acción',heroAlt:'Explorar funciones',
    proof1:'Una o múltiples ubicaciones',proof2:'Inglés y español',proof3:'Acceso por roles',
    priceEyebrow:'PROTECCIÓN DE MARGEN',priceTitle:'Detecta aumentos de proveedor antes de que se coman tu margen.',
    priceSub:'Price Watch convierte el historial de compras en inteligencia accionable por producto, proveedor y ubicación.',
    coreEyebrow:'INTELIGENCIA CENTRAL',coreTitle:'Un sistema operativo. Seis vistas de alto valor.',
    coreSub:'Pasa de reportes dispersos a una vista conectada que tu equipo realmente puede usar.',
    moreEyebrow:'MÁS OPSVISTA',moreTitle:'Más que dashboards. Diseñado para ejecutar la operación.',
    priceLabel:'Precio simple',priceHeading:'Empieza con una ubicación. Crece cuando estés listo.',
    priceText:'OpsVista está diseñado para restaurantes independientes, grupos en crecimiento y operadores multi-unidad.',
    per:' / ubicación / mes',tax:'Más impuestos aplicables. La disponibilidad de funciones puede depender de los sistemas conectados y el acceso a datos.',
    final:'Los datos de tu restaurante deberían decirte qué necesita atención.',
    finalSub:'Dinos cuántas ubicaciones operas y qué sistemas utilizas. Te mostraremos cómo OpsVista puede reunir la operación en una sola vista lista para tomar decisiones.',
    finalCta:'Solicitar Demo de OpsVista'
  }
} as const;

const core=[
  ['↗','Price Watch','Purchasing','Cost changes, supplier comparisons, recurring increases and margin-impact alerts.','Cambios de costo, comparación de proveedores, aumentos recurrentes y alertas de impacto al margen.'],
  ['◷','Labor Intelligence','Labor','Forecast vs actual sales, labor %, overtime exposure, SPLH and staffing guardrails.','Forecast vs ventas reales, labor %, exposición a overtime, SPLH y alertas de staffing.'],
  ['⚡','Action Center','Execution','Turn operational issues into assigned actions with ownership, evidence and verification.','Convierte problemas operativos en acciones asignadas con responsables, evidencia y verificación.'],
  ['$','Financial Intelligence','Finance','P&L context, AP, corporate expense allocation, purchasing and financial exceptions.','Contexto de P&L, AP, distribución de gastos corporativos, compras y excepciones financieras.'],
  ['★','Reputation Intelligence','Reputation','Google Reviews, rating movement, review velocity and location-level reputation signals.','Google Reviews, cambios de rating, velocidad de reseñas y señales por ubicación.'],
  ['▦','Performance Command Center','Multi-location','Compare sales, tasks, discounts, voids, labor and operational health across locations.','Compara ventas, tareas, descuentos, voids, labor y salud operativa entre ubicaciones.']
] as const;

const more=[
  ['Weekly Performance Scorecard','Tasks, discounts, voids, OT, reviews and manager accountability.','Tasks, descuentos, voids, OT, reviews y responsabilidad gerencial.'],
  ['Tasks & Logbook Compliance','Track completion, operational reporting and missed responsibilities.','Seguimiento de cumplimiento, reportes operativos y responsabilidades omitidas.'],
  ['Purchasing & Beverage Control','Orders, purchasing evidence, liquor purchases vs net liquor sales and validation.','Órdenes, evidencia de compras, compras de licor vs ventas netas y validación.'],
  ['Transfers & Inventory Movement','Track location-to-location movement with operational controls.','Controla movimientos entre ubicaciones con trazabilidad operativa.'],
  ['Projects & Priorities','Owners, progress, deadlines, milestones and operational projects.','Responsables, avance, fechas límite, milestones y proyectos operativos.'],
  ['Local Intelligence','Weather, events and local factors that can affect restaurant demand.','Clima, eventos y factores locales que pueden afectar la demanda.'],
  ['Smart Notifications','Email and mobile-ready alerts for operational exceptions and assigned actions.','Alertas por email y móvil para excepciones y acciones asignadas.'],
  ['OpsVista AI Copilot','Grounded explanations, operational context and recommended next moves.','Explicaciones basadas en datos, contexto operativo y próximos pasos recomendados.']
] as const;

export default function MarketingSite(){
  const [lang,setLang]=useState<Lang>(()=>localStorage.getItem('opsvista-site-lang')==='es'?'es':'en');
  const t=copy[lang];
  useEffect(()=>{localStorage.setItem('opsvista-site-lang',lang);document.documentElement.lang=lang},[lang]);
  return <div className="mkt">
    <style>{`
      .mkt{--bg:#07111f;--bg2:#0b1728;--panel:#102039;--panel2:#132640;--line:#213756;--text:#f7fbff;--muted:#a9bad0;--blue:#5da8ff;--cyan:#62e3d1;--gold:#f0c86b;--green:#65d7a1;--danger:#ff8b98;min-height:100vh;background:radial-gradient(circle at 12% 0%,rgba(52,112,193,.23),transparent 31%),radial-gradient(circle at 91% 11%,rgba(98,227,209,.11),transparent 26%),var(--bg);color:var(--text);font-family:Inter,ui-sans-serif,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}
      .mkt *{box-sizing:border-box}.mkt a{text-decoration:none;color:inherit}.mkt .wrap{width:min(1180px,calc(100% - 40px));margin:auto}.mkt .nav{position:sticky;top:0;z-index:40;border-bottom:1px solid rgba(93,168,255,.12);background:rgba(7,17,31,.84);backdrop-filter:blur(14px)}.mkt .navin{height:72px;display:flex;align-items:center;justify-content:space-between;gap:20px}.mkt .brand{display:flex;align-items:center;gap:11px;font-weight:950;letter-spacing:.05em}.mkt .mark{width:38px;height:38px;border-radius:12px;background:linear-gradient(145deg,var(--blue),var(--cyan));display:grid;place-items:center;color:#04121d;font-weight:1000}.mkt .brand small{display:block;font-size:9px;color:var(--muted);letter-spacing:.18em}.mkt .navlinks{display:flex;align-items:center;gap:18px;font-size:13px;color:#c8d6e8;font-weight:750}.mkt .langs{display:flex;border:1px solid var(--line);border-radius:999px;padding:3px;background:#0a1627}.mkt .langs button{border:0;background:transparent;color:var(--muted);padding:6px 9px;border-radius:999px;font:inherit;font-size:11px;font-weight:900;cursor:pointer}.mkt .langs button.on{background:#1a3559;color:#fff}.mkt .btn{display:inline-flex;align-items:center;justify-content:center;border-radius:12px;padding:12px 18px;font-weight:900;border:1px solid transparent;transition:.2s}.mkt .primary{background:linear-gradient(135deg,var(--blue),#4d7cff);color:#07111f;box-shadow:0 12px 32px rgba(93,168,255,.23)}.mkt .primary:hover{transform:translateY(-1px)}.mkt .secondary{border-color:var(--line);background:rgba(16,31,51,.7);color:#fff}.mkt .hero{padding:90px 0 72px}.mkt .heroGrid{display:grid;grid-template-columns:1.02fr .98fr;gap:48px;align-items:center}.mkt .kicker{display:inline-flex;gap:8px;align-items:center;padding:8px 12px;border-radius:999px;border:1px solid rgba(98,227,209,.27);background:rgba(98,227,209,.08);color:#9af0e4;font-size:12px;font-weight:900;margin-bottom:22px}.mkt .pulse{width:8px;height:8px;border-radius:50%;background:var(--cyan);box-shadow:0 0 18px var(--cyan)}.mkt h1{font-size:clamp(44px,5.8vw,75px);line-height:.98;letter-spacing:-.055em;margin:0}.mkt h1 span{background:linear-gradient(100deg,#fff 12%,#8abfff 60%,#7be9da);-webkit-background-clip:text;background-clip:text;color:transparent}.mkt .sub{font-size:19px;line-height:1.6;color:var(--muted);max-width:700px;margin:23px 0 0}.mkt .actions{display:flex;gap:11px;flex-wrap:wrap;margin-top:29px}.mkt .proof{display:flex;gap:20px;flex-wrap:wrap;margin-top:29px;color:#c9d6e7;font-size:12px}.mkt .proof b{color:var(--green)}.mkt .visual{position:relative;min-height:520px}.mkt .laptop{position:absolute;left:0;right:38px;top:0;border-radius:20px 20px 12px 12px;background:#07111d;border:1px solid #315177;box-shadow:0 28px 75px rgba(0,0,0,.44);padding:11px}.mkt .screen{border-radius:13px;background:linear-gradient(180deg,#11243d,#0d1b2e);min-height:355px;overflow:hidden;border:1px solid #1f3858}.mkt .screenTop{height:42px;border-bottom:1px solid #1d3654;display:flex;align-items:center;justify-content:space-between;padding:0 14px;font-size:11px;color:#9cb2ce}.mkt .screenDots{display:flex;gap:5px}.mkt .screenDots i{display:block;width:6px;height:6px;border-radius:50%;background:#44617f}.mkt .dash{padding:15px;display:grid;gap:11px}.mkt .dashMetrics{display:grid;grid-template-columns:repeat(3,1fr);gap:8px}.mkt .miniMetric{background:#0b192a;border:1px solid #1d3654;border-radius:11px;padding:10px}.mkt .miniMetric span{font-size:8px;color:#7189a7;text-transform:uppercase;font-weight:900;letter-spacing:.1em}.mkt .miniMetric strong{display:block;font-size:18px;margin-top:3px}.mkt .chart{height:92px;border-radius:11px;border:1px solid #1b3452;background:linear-gradient(180deg,rgba(93,168,255,.08),transparent),repeating-linear-gradient(0deg,transparent,transparent 22px,rgba(98,133,170,.08) 23px);position:relative;overflow:hidden}.mkt .chart svg{position:absolute;inset:0;width:100%;height:100%}.mkt .dashRows{display:grid;gap:7px}.mkt .dashRow{display:grid;grid-template-columns:1.2fr .7fr .55fr;gap:7px;padding:8px 9px;background:#0b192a;border:1px solid #1d3654;border-radius:9px;font-size:9px;color:#cbd8e8}.mkt .dashRow .up{color:#ff9eaa;font-weight:900}.mkt .base{position:absolute;left:-22px;right:15px;top:379px;height:18px;background:linear-gradient(180deg,#34465c,#1d2938);border-radius:3px 3px 15px 15px;box-shadow:0 8px 18px rgba(0,0,0,.28)}.mkt .tablet{position:absolute;right:-2px;bottom:1px;width:250px;height:310px;border-radius:25px;background:#07111d;border:1px solid #41638a;padding:9px;box-shadow:0 25px 55px rgba(0,0,0,.48);transform:rotate(2.5deg)}.mkt .tabletScreen{height:100%;border-radius:17px;background:#10213a;border:1px solid #1d3a5c;padding:14px}.mkt .tabletTitle{font-size:10px;color:#8aa2bf;font-weight:900;letter-spacing:.1em}.mkt .watchKpi{margin-top:10px;font-size:27px;font-weight:950}.mkt .watchKpi small{font-size:9px;color:#ff9daa}.mkt .watchItem{padding:10px;border-radius:10px;background:#0a1829;margin-top:8px;border:1px solid #1d3654}.mkt .watchItem strong{font-size:10px}.mkt .watchItem p{font-size:8px;color:#7f96b2;margin:3px 0 0}.mkt .operator{position:absolute;left:-12px;bottom:12px;background:rgba(9,21,36,.94);border:1px solid #29496c;border-radius:14px;padding:11px 13px;display:flex;align-items:center;gap:9px;box-shadow:0 14px 35px rgba(0,0,0,.32)}.mkt .avatar{width:32px;height:32px;border-radius:50%;background:linear-gradient(145deg,#315e93,#74b3ff);display:grid;place-items:center;font-size:13px;font-weight:1000;color:#06111f}.mkt .operator strong{display:block;font-size:10px}.mkt .operator span{font-size:8px;color:#89a1bd}.mkt .section{padding:78px 0}.mkt .eyebrow{font-size:11px;color:#7ed9ff;font-weight:950;letter-spacing:.17em}.mkt h2{font-size:clamp(34px,4.1vw,52px);line-height:1.06;letter-spacing:-.035em;margin:9px 0 0;max-width:820px}.mkt .lead{font-size:17px;color:var(--muted);max-width:780px;margin-top:14px}.mkt .watchGrid{display:grid;grid-template-columns:.92fr 1.08fr;gap:24px;margin-top:34px}.mkt .panel{background:linear-gradient(180deg,#10213a,#0d1b2f);border:1px solid var(--line);border-radius:23px;padding:28px;box-shadow:0 22px 60px rgba(0,0,0,.24)}.mkt .ficon{width:46px;height:46px;border-radius:14px;background:linear-gradient(145deg,#193d65,#1e557e);display:grid;place-items:center;font-size:20px;margin-bottom:18px}.mkt .panel h3{font-size:27px;margin:0}.mkt .panel p{color:var(--muted)}.mkt .bullets{display:grid;gap:11px;margin-top:20px;font-size:13px}.mkt .bullet{display:flex;gap:9px}.mkt .bullet b{color:var(--green)}.mkt .table{background:#091728;border:1px solid var(--line);border-radius:23px;padding:20px;display:grid;gap:9px}.mkt .prow{display:grid;grid-template-columns:1.25fr .7fr .7fr .65fr;gap:8px;padding:12px;border-radius:11px;background:#102138;font-size:11px;align-items:center}.mkt .prow.head{background:transparent;padding-top:0;color:#718aa8;font-size:9px;text-transform:uppercase;font-weight:950;letter-spacing:.1em}.mkt .prow .up{color:#ff9aa7;font-weight:950}.mkt .prow .save{color:#78dfa9;font-weight:950}.mkt .core{display:grid;grid-template-columns:repeat(3,1fr);gap:17px;margin-top:33px}.mkt .coreCard{background:rgba(16,31,51,.8);border:1px solid var(--line);border-radius:19px;padding:22px;min-height:220px}.mkt .coreCard .mini{font-size:9px;color:#7ed9ff;text-transform:uppercase;letter-spacing:.13em;font-weight:950}.mkt .coreCard h3{font-size:18px;margin:12px 0 7px}.mkt .coreCard p{font-size:13px;color:var(--muted)}.mkt .more{display:grid;grid-template-columns:repeat(4,1fr);gap:11px;margin-top:28px}.mkt .moreCard{padding:15px;border-radius:14px;border:1px solid #1d3450;background:rgba(10,23,40,.65)}.mkt .moreCard strong{font-size:12px}.mkt .moreCard p{font-size:11px;color:#879cb7;margin:5px 0 0}.mkt .integrations{display:flex;flex-wrap:wrap;gap:9px;margin-top:21px}.mkt .integration{padding:8px 11px;border-radius:9px;border:1px solid var(--line);background:#0b1829;color:#c4d4e8;font-size:11px;font-weight:850}.mkt .how{display:grid;grid-template-columns:repeat(4,1fr);gap:1px;background:var(--line);border:1px solid var(--line);border-radius:19px;overflow:hidden;margin-top:30px}.mkt .how div{background:#0d1b2f;padding:21px}.mkt .how strong{font-size:20px}.mkt .how p{font-size:11px;color:var(--muted);margin:5px 0 0}.mkt .pricing{display:grid;grid-template-columns:.85fr 1.15fr;gap:24px;align-items:center}.mkt .priceCard{background:linear-gradient(145deg,#17365a,#102038);border:1px solid rgba(93,168,255,.27);border-radius:25px;padding:31px;box-shadow:0 22px 60px rgba(0,0,0,.28)}.mkt .priceNum{font-size:56px;font-weight:1000;letter-spacing:-.055em;margin:4px 0}.mkt .priceNum small{font-size:16px;color:var(--muted);letter-spacing:0}.mkt .note{font-size:12px;color:var(--muted)}.mkt .cta{padding:70px 0 90px}.mkt .ctaBox{text-align:center;padding:52px 28px;border-radius:27px;background:linear-gradient(145deg,#122946,#0d1d32);border:1px solid var(--line)}.mkt .ctaBox h2{margin:8px auto 0}.mkt .ctaBox p{max-width:700px;margin:13px auto 22px;color:var(--muted)}.mkt footer{border-top:1px solid rgba(33,55,86,.7);padding:28px 0 38px;color:#7890ad;font-size:11px}.mkt .foot{display:flex;justify-content:space-between;gap:20px;flex-wrap:wrap}
      @media(max-width:980px){.mkt .heroGrid,.mkt .watchGrid,.mkt .pricing{grid-template-columns:1fr}.mkt .visual{min-height:500px;max-width:720px}.mkt .core{grid-template-columns:repeat(2,1fr)}.mkt .more{grid-template-columns:repeat(2,1fr)}.mkt .navlinks>a:not(.btn){display:none}}
      @media(max-width:650px){.mkt .wrap{width:min(100% - 26px,1180px)}.mkt .navin{height:64px}.mkt .brand small{display:none}.mkt .navlinks .secondary{display:none}.mkt .hero{padding:52px 0}.mkt .sub{font-size:16px}.mkt .visual{min-height:430px}.mkt .laptop{right:10px}.mkt .screen{min-height:295px}.mkt .base{top:319px}.mkt .tablet{width:190px;height:250px}.mkt .operator{bottom:0}.mkt .core,.mkt .more,.mkt .how{grid-template-columns:1fr}.mkt .dashMetrics{grid-template-columns:repeat(3,1fr)}.mkt .prow{grid-template-columns:1.35fr .7fr .65fr}.mkt .prow>*:nth-child(4){display:none}.mkt .section{padding:62px 0}.mkt .priceNum{font-size:48px}}
    `}</style>

    <nav className="nav"><div className="wrap navin">
      <a className="brand" href="#"><span className="mark">OV</span><span>OPSVISTA<small>RESTAURANT OPERATIONS INTELLIGENCE</small></span></a>
      <div className="navlinks">
        <a href="#features">{t.navFeatures}</a><a href="#how">{t.navHow}</a><a href="#pricing">{t.navPricing}</a>
        <div className="langs"><button className={lang==='en'?'on':''} onClick={()=>setLang('en')}>EN</button><button className={lang==='es'?'on':''} onClick={()=>setLang('es')}>ES</button></div>
        <a className="btn secondary" href="https://restaurant-support.vercel.app">{t.login}</a>
        <a className="btn primary" href="#demo">{t.demo}</a>
      </div>
    </div></nav>

    <header className="hero"><div className="wrap heroGrid">
      <div>
        <div className="kicker"><span className="pulse"/>{t.kicker}</div>
        <h1><span>{t.hero}</span></h1>
        <p className="sub">{t.heroSub}</p>
        <div className="actions"><a className="btn primary" href="#demo">{t.heroCta}</a><a className="btn secondary" href="#features">{t.heroAlt}</a></div>
        <div className="proof"><span><b>✓</b> {t.proof1}</span><span><b>✓</b> {t.proof2}</span><span><b>✓</b> {t.proof3}</span></div>
      </div>
      <div className="visual" aria-label="OpsVista on laptop and tablet">
        <div className="laptop"><div className="screen">
          <div className="screenTop"><span>OpsVista · Command Center</span><span className="screenDots"><i/><i/><i/></span></div>
          <div className="dash">
            <div className="dashMetrics"><div className="miniMetric"><span>Net Sales</span><strong>$368.9K</strong></div><div className="miniMetric"><span>Tasks</span><strong>92.6%</strong></div><div className="miniMetric"><span>Actions</span><strong>8</strong></div></div>
            <div className="chart"><svg viewBox="0 0 500 100" preserveAspectRatio="none"><polyline fill="none" stroke="#65d7a1" strokeWidth="3" points="0,77 58,63 112,70 165,47 222,54 274,32 330,44 390,23 444,33 500,17"/></svg></div>
            <div className="dashRows"><div className="dashRow"><b>Orange</b><span>$62.8K</span><span>18.2%</span></div><div className="dashRow"><b>Stamford</b><span>$32.3K</span><span>7.5%</span></div><div className="dashRow"><b>Price Alert · Beef</b><span>$16.59</span><span className="up">+11.8%</span></div></div>
          </div>
        </div></div><div className="base"/>
        <div className="tablet"><div className="tabletScreen"><div className="tabletTitle">PRICE WATCH</div><div className="watchKpi">12 <small>ALERTS</small></div><div className="watchItem"><strong>Premium Beef Cut · +11.8%</strong><p>4-week high · review supplier</p></div><div className="watchItem"><strong>Glass Cleaner · +26.0%</strong><p>Lower comparable supplier found</p></div><div className="watchItem"><strong>French Fries · -8.4%</strong><p>Preferred buy identified</p></div></div></div>
        <div className="operator"><div className="avatar">RR</div><div><strong>Operations Director</strong><span>Multi-location command view · laptop + tablet</span></div></div>
      </div>
    </div></header>

    <section className="section" id="features"><div className="wrap">
      <div className="eyebrow">{t.priceEyebrow}</div><h2>{t.priceTitle}</h2><p className="lead">{t.priceSub}</p>
      <div className="watchGrid">
        <div className="panel"><div className="ficon">↗</div><h3>Price Watch & Price Alerts</h3><p>{lang==='en'?'Monitor current purchasing cost against recent history, identify abnormal increases and surface the items that matter most financially.':'Compara el costo actual contra el historial reciente, identifica aumentos anormales y prioriza los productos con mayor impacto económico.'}</p>
          <div className="bullets">
            {[
              ['Flag increases above 5%, 10% and 20%','Alertas por aumentos superiores a 5%, 10% y 20%'],
              ['Compare suppliers and locations','Compara proveedores y ubicaciones'],
              ['Validate pack size, UOM and product presentation','Valida pack size, UOM y presentación del producto'],
              ['Estimate economic impact using purchasing volume','Estima impacto económico según volumen comprado'],
              ['Spot consecutive increases, duplicates, credits and substitutions','Detecta aumentos consecutivos, duplicados, créditos y sustituciones']
            ].map((b,i)=><div className="bullet" key={i}><b>✓</b><span>{b[lang==='en'?0:1]}</span></div>)}
          </div>
        </div>
        <div className="table">
          <div className="prow head"><span>Product</span><span>Current</span><span>Change</span><span>Signal</span></div>
          <div className="prow"><b>Premium Beef Cut</b><span>$16.59</span><span className="up">+11.8%</span><span>4-week high</span></div>
          <div className="prow"><b>Glass Cleaner</b><span>$47.90</span><span className="up">+26.0%</span><span>alt. supplier</span></div>
          <div className="prow"><b>French Fries</b><span>$31.20</span><span className="save">-8.4%</span><span>preferred buy</span></div>
          <div className="prow"><b>American Cheese</b><span>$2.31/lb</span><span className="save">SAVE</span><span>pack normalized</span></div>
          <div className="prow"><b>Premium Water</b><span>$24.70</span><span className="save">-6.2%</span><span>supplier match</span></div>
        </div>
      </div>
    </div></section>

    <section className="section"><div className="wrap">
      <div className="eyebrow">{t.coreEyebrow}</div><h2>{t.coreTitle}</h2><p className="lead">{t.coreSub}</p>
      <div className="core">{core.map(([icon,title,mini,en,es])=><article className="coreCard" key={title}><span className="mini">{mini}</span><div className="ficon">{icon}</div><h3>{title}</h3><p>{lang==='en'?en:es}</p></article>)}</div>
    </div></section>

    <section className="section"><div className="wrap">
      <div className="eyebrow">{t.moreEyebrow}</div><h2>{t.moreTitle}</h2>
      <div className="more">{more.map(([title,en,es])=><div className="moreCard" key={title}><strong>{title}</strong><p>{lang==='en'?en:es}</p></div>)}</div>
      <div className="integrations"><span className="integration">Toast</span><span className="integration">7shifts</span><span className="integration">Restaurant365</span><span className="integration">Google Business Profile</span><span className="integration">Ramp</span><span className="integration">Provi Evidence</span></div>
      <div className="how" id="how">{[
        ['Find','Detecta','Surface costly exceptions earlier.','Encuentra excepciones costosas antes.'],
        ['Compare','Compara','See performance across locations.','Ve desempeño entre ubicaciones.'],
        ['Act','Actúa','Assign ownership and next steps.','Asigna responsables y próximos pasos.'],
        ['Verify','Verifica','Confirm whether the action worked.','Confirma si la acción funcionó.']
      ].map((x,i)=><div key={i}><strong>{x[lang==='en'?0:1]}</strong><p>{x[lang==='en'?2:3]}</p></div>)}</div>
    </div></section>

    <section className="section" id="pricing"><div className="wrap pricing">
      <div><div className="eyebrow">{t.priceLabel.toUpperCase()}</div><h2>{t.priceHeading}</h2><p className="lead">{t.priceText}</p></div>
      <div className="priceCard"><div className="eyebrow">OPSVISTA PLATFORM</div><div className="priceNum">$79 <small>{t.per}</small></div><p className="note">{t.tax}</p><div className="actions"><a className="btn primary" href="#demo">{t.demo}</a></div></div>
    </div></section>

    <section className="cta" id="demo"><div className="wrap"><div className="ctaBox"><div className="eyebrow">OPSVISTA</div><h2>{t.final}</h2><p>{t.finalSub}</p><a className="btn primary" href="mailto:rodriguez.evolife@gmail.com?subject=OpsVista%20Demo%20Request">{t.finalCta}</a></div></div></section>
    <footer><div className="wrap foot"><span>© 2026 OpsVista · Restaurant Operations Intelligence</span><a href="https://restaurant-support.vercel.app">{t.login}</a></div></footer>
  </div>
}
