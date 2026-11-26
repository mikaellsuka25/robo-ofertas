// Frases de chamada (a linha em MAIÚSCULAS no topo da mensagem).
// A frase é escolhida pelo tipo de produto; se não houver uma específica, usa uma genérica.
// Pode editar à vontade: uma frase por linha dentro de cada lista.

const POR_TIPO = {
  cadeira: [
    'Sua coluna vai agradecer por essa escolha',
    'Conforto pra trabalhar, estudar e jogar o dia inteiro',
    'O lugar mais disputado da casa acabou de chegar',
  ],
  poltrona: ['Aquele cantinho de leitura que você sempre quis'],
  espelho: [
    'Um detalhe que muda a cara do ambiente inteiro',
    'Mais luz e amplitude pra sua casa sem reforma',
    'O toque de decoração que todo mundo vai elogiar',
  ],
  toalha: [
    'Toalha macia é o abraço depois do banho',
    'Hora de aposentar aquelas toalhas velhas',
    'Banho de hotel sem sair de casa',
  ],
  lencol: [
    'Cama arrumada é outro nível de descanso',
    'Noites mais gostosas começam por aqui',
    'Lençol novo é a felicidade de deitar na cama',
  ],
  jogo: ['Kit completo e com preço de achadinho'],
  edredom: ['O friozinho ficou bem mais gostoso', 'Pra se enrolar e não querer sair da cama'],
  cobertor: ['O friozinho ficou bem mais gostoso', 'Quentinho, macio e com preço de ocasião'],
  manta: ['Sofá, filme e essa manta: combinação perfeita', 'Quentinha, macia e linda na decoração'],
  travesseiro: ['Dormir bem começa pelo travesseiro certo', 'Acorde sem dor no pescoço'],
  almofada: ['Um jeito barato de deixar o sofá novo'],
  cortina: ['Escurece o quarto e deixa o ambiente lindo', 'Mais privacidade e muito mais estilo'],
  tapete: ['O detalhe que deixa a casa mais aconchegante', 'Conforto pros pés e charme pro ambiente'],
  passadeira: ['Cozinha mais bonita e sem escorregão'],
  sofa: ['Sofá com cara de novo gastando pouco'],
  capa: ['Renove o ambiente sem trocar os móveis'],
  mesa: ['Prática, bonita e cabe em qualquer cantinho'],
  rack: ['A sala organizada que você merece'],
  nicho: ['Organiza e decora ao mesmo tempo'],
  prateleira: ['Organiza e decora ao mesmo tempo', 'Espaço extra sem ocupar o chão'],
  sapateira: ['Chega de sapato espalhado pela casa'],
  organizador: ['Tudo no lugar e fácil de achar', 'A casa organizada que você sempre quis'],
  cabideiro: ['Chega de roupa jogada na cadeira'],
  quadro: ['Parede vazia nunca mais', 'Decoração com preço de achadinho'],
  vaso: ['Verde e charme sem trabalho nenhum'],
  planta: ['Verde o ano inteiro e sem precisar regar'],
  luminaria: ['A luz certa muda tudo no ambiente', 'Clima aconchegante com um clique'],
  fita: ['Transforma o quarto com um efeito incrível'],
  abajur: ['Luz aconchegante pra ler e relaxar'],
  relogio: ['Pontualidade com estilo na parede'],
  porta: ['Suas melhores memórias merecem destaque'],
  difusor: ['Casa cheirosa o dia inteiro'],
  vela: ['Cheirinho bom e clima de spa em casa'],
  panela: ['Cozinhar fica muito mais gostoso assim', 'Sua cozinha merece esse upgrade'],
  copo: ['Pra servir bonito sem gastar muito'],
  aparelho: ['Mesa posta digna de revista'],
  pote: ['Comida fresca e geladeira organizada'],
  lixeira: ['Até o lixo ganha um cantinho discreto e organizado na casa'],
  varal: ['Roupa seca em qualquer espaço da casa'],
  fone: ['Seu som, sem fio e sem complicação'],
  smartwatch: ['Seu dia inteiro no pulso'],
  carregador: ['Bateria cheia em minutos'],
};

const GENERICAS = [
  'Achadinho pra deixar a casa mais bonita',
  'Preço desses não dura muito',
  'Daqueles achados que dá vontade de contar pra todo mundo',
  'Sua casa vai ficar outra com isso aqui',
  'Praticidade que faz diferença no dia a dia',
  'Corre que esse preço tá bom demais',
  'Útil, bonito e baratinho',
  'Aquele detalhe que faltava na sua casa',
  'Promoção boa é assim: chegou, aproveitou',
  'Pra quem ama casa organizada e bonita',
];

// Escolha estável: a mesma oferta sempre recebe a mesma frase
function hash(str) {
  let h = 0;
  for (const c of String(str)) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return h;
}

function chamada(tipo, chave) {
  const lista = (tipo && POR_TIPO[tipo]) || GENERICAS;
  return lista[hash(chave) % lista.length].toUpperCase();
}

module.exports = { chamada, POR_TIPO, GENERICAS };
