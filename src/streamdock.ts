/**
 * streamdock.ts
 * Capa de comunicación WebSocket con el software StreamDock (HotSpot).
 * Mismo protocolo que Elgato Stream Deck — sin SDK de terceros.
 *
 * StreamDock arranca el plugin con estos argumentos CLI:
 *   -port <número>          puerto WebSocket local
 *   -pluginUUID <uuid>      UUID de registro
 *   -registerEvent <evento> nombre del evento de registro
 *   -info <json>            info del dispositivo
 */
import WebSocket from 'ws';

// ─── Tipos ────────────────────────────────────────────────────────────────────

export interface SDEvent {
  event:    string;
  action?:  string;
  context?: string;
  device?:  string;
  payload?: Record<string, unknown>;
}

export type SDEventHandler = (ev: SDEvent) => void | Promise<void>;

// ─── Helper para leer args CLI ────────────────────────────────────────────────

function getArg(name: string): string {
  const args = process.argv.slice(2);
  const idx  = args.indexOf(name);
  return idx !== -1 ? (args[idx + 1] ?? '') : '';
}

// ─── Clase principal ──────────────────────────────────────────────────────────

class StreamDock {
  private ws: WebSocket | null = null;
  private readonly handlers = new Map<string, SDEventHandler[]>();

  private readonly port          = parseInt(getArg('-port'), 10);
  private readonly uuid          = getArg('-pluginUUID');
  private readonly registerEvent = getArg('-registerEvent');

  // ─── Conexión ───────────────────────────────────────────────────────────────

  connect(): void {
    this.ws = new WebSocket(`ws://127.0.0.1:${this.port}`);

    let announced = false;

    this.ws.on('open', () => {
      // Registro obligatorio al conectar
      this.send({ event: this.registerEvent, uuid: this.uuid });
      this.log('Music Deck conectado al StreamDock');
    });

    this.ws.on('message', (raw: Buffer) => {
      // Evento propio (no del protocolo) al llegar el primer mensaje: VSD Craft
      // ignora pedidos (p. ej. getGlobalSettings) enviados justo al abrir, antes
      // de terminar de procesar el registro.
      if (!announced) {
        announced = true;
        for (const h of this.handlers.get('connected') ?? []) void h({ event: 'connected' });
      }
      try {
        const ev = JSON.parse(raw.toString()) as SDEvent;
        const list = this.handlers.get(ev.event) ?? [];
        for (const h of list) void h(ev);
      } catch (err) {
        console.error('[MusicDeck] parse error:', err);
      }
    });

    this.ws.on('close', () => {
      this.log('Desconectado — reconectando en 5 s');
      setTimeout(() => this.connect(), 5_000);
    });

    this.ws.on('error', (err: Error) => {
      console.error('[MusicDeck] ws error:', err.message);
    });
  }

  // ─── Suscripción a eventos ───────────────────────────────────────────────────

  on(event: string, handler: SDEventHandler): void {
    const list = this.handlers.get(event) ?? [];
    list.push(handler);
    this.handlers.set(event, list);
  }

  // ─── Enviar datos ────────────────────────────────────────────────────────────

  send(payload: object): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(payload));
    }
  }

  /** Actualiza la imagen de una acción (key o touch strip) */
  setImage(context: string, base64DataUrl: string): void {
    this.send({
      event:   'setImage',
      context,
      payload: { image: base64DataUrl, target: 0 },
    });
  }

  /** Cambia el título de un botón */
  setTitle(context: string, title: string): void {
    this.send({
      event:   'setTitle',
      context,
      payload: { title, target: 0 },
    });
  }

  /** Pide los ajustes globales; llegan en un evento didReceiveGlobalSettings */
  getGlobalSettings(): void {
    this.send({ event: 'getGlobalSettings', context: this.uuid });
  }

  /** Envía mensaje al log del StreamDock */
  log(message: string): void {
    this.send({
      event:   'logMessage',
      payload: { message: `[MusicDeck] ${message}` },
    });
  }
}

// Singleton exportado
export const sd = new StreamDock();
