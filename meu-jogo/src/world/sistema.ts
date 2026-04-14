import { Container, Graphics } from 'pixi.js';
import type { Sol, Planeta, Sistema } from '../types';
import { DIST_MIN_SISTEMA } from './constantes';
import { TIPO_PLANETA } from './planeta';
import { criarPlanetaProceduralSprite, criarEstrelaProcedural } from './planeta-procedural';
import { criarEstadoPesquisas } from './pesquisa';
import { gerarNomePlaneta } from './nomes';

function sortearTipoPlaneta(): string {
  const tipos = Object.values(TIPO_PLANETA);
  return tipos[Math.floor(Math.random() * tipos.length)];
}

export function criarSistemaSolar(container: Container, orbitasContainer: Container, centroX: number, centroY: number, indiceSistema: number): Sistema {
  const corSol = [0xffd166, 0xffb703, 0xfff1a8, 0xf4a261][indiceSistema % 4];
  const quantidadePlanetas = 1 + Math.floor(Math.random() * 5);
  const tamanhosPlaneta = Array.from({ length: quantidadePlanetas }, () => 140 + Math.random() * 170);
  const maiorPlaneta = Math.max(...tamanhosPlaneta);
  const raioSol = Math.max(110 + Math.random() * 60, maiorPlaneta * 1.5);

  const solMesh = criarEstrelaProcedural(centroX, centroY, raioSol);
  const sol = solMesh as unknown as Sol;
  sol._raio = raioSol;
  sol._cor = corSol;
  sol._tipoAlvo = 'sol';
  sol._visivelAoJogador = false;
  sol._descobertoAoJogador = false;
  sol.visible = false;
  container.addChild(sol);

  const planetas: Planeta[] = [];
  let ultimoRaioOrbita = raioSol;
  let ultimoRaioPlaneta = 0;
  const margemEntreOrbital = 90;

  for (let i = 0; i < quantidadePlanetas; i++) {
    const tamanho = tamanhosPlaneta[i];
    const raioPlaneta = tamanho / 2;
    const distanciaMinDoSol = raioSol * 1.5 + raioPlaneta + 220;
    const distanciaMinDoAnterior = ultimoRaioOrbita + ultimoRaioPlaneta + raioPlaneta + margemEntreOrbital;
    const baseOrbita = i === 0 ? distanciaMinDoSol : Math.max(distanciaMinDoSol, distanciaMinDoAnterior);
    const raioOrbita = baseOrbita + Math.random() * 70;
    const anguloInicial = Math.random() * Math.PI * 2;
    const velocidade = 0.00003 + Math.random() * 0.000025;
    const tipoPlaneta = sortearTipoPlaneta();
    const linhaOrbita = new Graphics();
    linhaOrbita.visible = false;
    linhaOrbita.circle(centroX, centroY, raioOrbita).stroke({
      color: corSol,
      width: 2,
      alpha: 0.3,
    });
    orbitasContainer.addChild(linhaOrbita);

    const sprite = criarPlanetaProceduralSprite(
      centroX + Math.cos(anguloInicial) * raioOrbita,
      centroY + Math.sin(anguloInicial) * raioOrbita,
      tamanho,
      tipoPlaneta,
    );
    const p = sprite as unknown as Planeta;

    p.dados = {
      dono: 'neutro',
      tipoPlaneta,
      nome: gerarNomePlaneta(tipoPlaneta),
      producao: 1,
      recursos: { comum: 0, raro: 0, combustivel: 0 },
      tamanho,
      selecionado: false,
      fabricas: 0,
      infraestrutura: 0,
      naves: 0,
      acumuladorRecursosMs: 0,
      fracProducao: { comum: 0, raro: 0, combustivel: 0 },
      sistemaId: indiceSistema,
      construcaoAtual: null,
      producaoNave: null,
      filaProducao: [],
      repetirFilaProducao: false,
      pesquisas: criarEstadoPesquisas(),
      pesquisaAtual: null,
    };
    p._tipoAlvo = 'planeta';
    p._orbita = {
      centroX,
      centroY,
      raio: raioOrbita,
      angulo: anguloInicial,
      velocidade,
    };
    p._linhaOrbita = linhaOrbita;
    p._visivelAoJogador = false;
    p._descobertoAoJogador = false;
    p._planetFilter = (sprite as any)._planetFilter;

    const anel = new Graphics();
    p.addChild(anel);
    p._anel = anel;

    const construcoes = new Graphics();
    p.addChild(construcoes);
    p._construcoes = construcoes;

    p.visible = false;
    container.addChild(p);
    planetas.push(p);
    ultimoRaioOrbita = raioOrbita;
    ultimoRaioPlaneta = raioPlaneta;
  }

  return { x: centroX, y: centroY, sol, planetas };
}

export { DIST_MIN_SISTEMA };
