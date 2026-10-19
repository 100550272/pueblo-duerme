const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static('public'));

let partida = {
    estado: 'lobby', 
    jugadores: [],
    config: {},
    ronda: 0,
    enamorados: [],
    brujaPociones: { vida: true, muerte: true },
    votosLobos: {},
    votosDia: {},
    victimaLobos: null,
    victimaBruja: null,
    brujaCuro: false,
    cazadorVengando: null,
    estadoSiguiente: null,
    mensajes: []
};

function enviarEstado() {
    io.emit('actualizarEstado', partida);
}

function asignarRoles() {
    let roles = [];
    for (let i = 0; i < partida.config.lobos; i++) roles.push('Lobo');
    if (partida.config.cupido) roles.push('Cupido');
    if (partida.config.vidente) roles.push('Vidente');
    if (partida.config.bruja) roles.push('Bruja');
    if (partida.config.cazador) roles.push('Cazador');
    
    while (roles.length < partida.jugadores.length) roles.push('Campesino');
    roles = roles.sort(() => Math.random() - 0.5);
    
    partida.jugadores.forEach((j, i) => { j.rol = roles[i]; j.vivo = true; });
}

function rolesVivos(rol) {
    return partida.jugadores.filter(j => j.vivo && j.rol === rol).length;
}

function comprobarVictoria() {
    const vivos = partida.jugadores.filter(j => j.vivo);
    const lobosVivos = vivos.filter(j => j.rol === 'Lobo').length;
    const puebloVivos = vivos.length - lobosVivos;
    
    if (vivos.length === 2 && partida.enamorados.includes(vivos[0].id) && partida.enamorados.includes(vivos[1].id)) {
        partida.estado = 'fin';
        partida.mensajes.push("¡El amor triunfa! Los enamorados han ganado la partida.");
        return true;
    }
    if (lobosVivos === 0) {
        partida.estado = 'fin';
        partida.mensajes.push("¡Los campesinos han erradicado a los lobos y ganado!");
        return true;
    } else if (lobosVivos >= puebloVivos) {
        partida.estado = 'fin';
        partida.mensajes.push("¡Los lobos son mayoría y devoran el pueblo!");
        return true;
    }
    return false;
}

function procesarMuertes(listaIds, siguienteFase, causa = 'noche') {
    let cazadorMuertoId = null;

    listaIds.forEach(id => {
        let j = partida.jugadores.find(x => x.id === id);
        if (j && j.vivo) {
            j.vivo = false;
            
            if (causa === 'linchamiento') {
                partida.mensajes.push(`🔥 ${j.nombre} ha sido linchado por el pueblo. Su rol era: ${j.rol}.`);
            } else {
                partida.mensajes.push(`💀 ${j.nombre} ha muerto. Su rol era: ${j.rol}.`);
            }

            if (partida.enamorados.includes(j.id)) {
                let otroId = partida.enamorados.find(e => e !== j.id);
                let otro = partida.jugadores.find(x => x.id === otroId);
                if (otro && otro.vivo) {
                    otro.vivo = false;
                    partida.mensajes.push(`💔 ${otro.nombre} no soportó la pérdida de su amado/a y murió de tristeza. Era: ${otro.rol}.`);
                    if (otro.rol === 'Cazador') cazadorMuertoId = otro.id;
                }
            }
            if (j.rol === 'Cazador') cazadorMuertoId = j.id;
        }
    });

    if (cazadorMuertoId) {
        partida.cazadorVengando = cazadorMuertoId;
        partida.estadoSiguiente = siguienteFase;
        partida.estado = 'venganza_cazador';
        partida.mensajes.push("🏹 El Cazador ha muerto, pero antes de exhalar su último aliento... elegirá a quién llevarse a la tumba.");
        enviarEstado();
        return; 
    }

    if (comprobarVictoria()) { enviarEstado(); return; }

    partida.estado = siguienteFase;
    if (siguienteFase === 'dia') {
        partida.mensajes.push("☀️ Ha amanecido en el pueblo. Es hora de debatir y votar.");
    } else if (siguienteFase === 'noche_inicio') {
        avanzarFaseNoche('inicio');
        return; 
    }
    enviarEstado();
}

function avanzarFaseNoche(faseActual) {
    if (comprobarVictoria()) { enviarEstado(); return; }

    if (faseActual === 'inicio') {
        partida.ronda++;
        partida.victimaLobos = null;
        partida.victimaBruja = null;
        partida.brujaCuro = false;
        partida.votosLobos = {};
        partida.votosDia = {};
        
        partida.mensajes.push(`🌙 Cae la noche en el pueblo (Ronda ${partida.ronda}). Todos cierran los ojos.`);
        
        if (partida.ronda === 1 && rolesVivos('Cupido') > 0) partida.estado = 'noche_cupido';
        else avanzarFaseNoche('cupido');
    }
    else if (faseActual === 'cupido') {
        if (rolesVivos('Vidente') > 0) partida.estado = 'noche_vidente';
        else avanzarFaseNoche('vidente');
    }
    else if (faseActual === 'vidente') {
        if (rolesVivos('Lobo') > 0) partida.estado = 'noche_lobos';
        else avanzarFaseNoche('lobos');
    }
    else if (faseActual === 'lobos') {
        if (rolesVivos('Bruja') > 0) partida.estado = 'noche_bruja';
        else avanzarFaseNoche('bruja');
    }
    else if (faseActual === 'bruja') {
        let muertes = [];
        if (partida.victimaLobos && !partida.brujaCuro) muertes.push(partida.victimaLobos);
        if (partida.victimaBruja) muertes.push(partida.victimaBruja);
        
        if (muertes.length === 0) partida.mensajes.push("☀️ Ha amanecido. Milagrosamente, nadie ha muerto esta noche.");
        
        procesarMuertes(muertes, 'dia');
        return; 
    }
    enviarEstado();
}

function calcularMasVotado(votos) {
    let conteo = {};
    Object.values(votos).forEach(id => conteo[id] = (conteo[id] || 0) + 1);
    let maxVotos = 0;
    for (const cant of Object.values(conteo)) {
        if (cant > maxVotos) maxVotos = cant;
    }
    if (maxVotos === 0) return [];
    let masVotados = [];
    for (const [id, cant] of Object.entries(conteo)) {
        if (cant === maxVotos) masVotados.push(id);
    }
    return masVotados; 
}

function evaluarVotosLobos() {
    const lobosVivos = partida.jugadores.filter(j => j.rol === 'Lobo' && j.vivo);
    if (lobosVivos.length === 0) return;

    let todosHanVotado = true;
    let votoUnanime = true;
    let primerVoto = null;

    for (let lobo of lobosVivos) {
        const voto = partida.votosLobos[lobo.id];
        if (!voto) {
            todosHanVotado = false;
            break;
        }
        if (!primerVoto) primerVoto = voto;
        else if (voto !== primerVoto) votoUnanime = false;
    }

    if (todosHanVotado && votoUnanime) {
        partida.victimaLobos = primerVoto;
        avanzarFaseNoche('lobos');
    }
}

io.on('connection', (socket) => {
    socket.on('unirse', (nombre) => {
        if (partida.estado !== 'lobby' && partida.estado !== 'fin') return socket.emit('error', 'La partida está en curso');
        partida.jugadores.push({ id: socket.id, nombre: nombre || `Jugador ${partida.jugadores.length + 1}`, vivo: true, rol: 'Asignando...' });
        enviarEstado();
    });

    socket.on('empezarPartida', (config) => {
        partida.config = config;
        asignarRoles();
        avanzarFaseNoche('inicio');
    });

    socket.on('accionCupido', (ids) => {
        if (partida.estado !== 'noche_cupido') return;
        // NUEVO: Candado de seguridad por si envían menos de 2
        if (!Array.isArray(ids) || ids.length !== 2) return; 
        partida.enamorados = ids;
        avanzarFaseNoche('cupido');
    });

    socket.on('accionVidente', (id) => {
        if (partida.estado !== 'noche_vidente') return;
        const objetivo = partida.jugadores.find(j => j.id === id);
        socket.emit('mensajePrivado', `El rol de ${objetivo.nombre} es: ${objetivo.rol}`);
        avanzarFaseNoche('vidente');
    });

    socket.on('accionLobos', (id) => {
        if (partida.estado !== 'noche_lobos') return;
        partida.votosLobos[socket.id] = id;
        enviarEstado(); 
        evaluarVotosLobos(); 
    });

    socket.on('enviarChatLobo', (msg) => {
        if (partida.estado !== 'noche_lobos') return;
        const autor = partida.jugadores.find(j => j.id === socket.id);
        if (autor && autor.rol === 'Lobo' && autor.vivo) {
            partida.jugadores.filter(j => j.rol === 'Lobo').forEach(lobo => {
                io.to(lobo.id).emit('nuevoChatLobo', { nombre: autor.nombre, msg });
            });
        }
    });

    socket.on('accionBruja', (data) => {
        if (partida.estado !== 'noche_bruja') return;
        if (data.curar && partida.brujaPociones.vida) {
            partida.brujaCuro = true;
            partida.brujaPociones.vida = false;
        }
        if (data.matar && partida.brujaPociones.muerte) {
            partida.victimaBruja = data.matar;
            partida.brujaPociones.muerte = false;
        }
        avanzarFaseNoche('bruja');
    });

    socket.on('accionCazador', (id) => {
        if (partida.estado !== 'venganza_cazador' || socket.id !== partida.cazadorVengando) return;
        partida.cazadorVengando = null;
        partida.mensajes.push(`💥 El Cazador disparó su arma antes de morir. Su objetivo fue...`);
        procesarMuertes([id], partida.estadoSiguiente);
    });

    socket.on('votarDia', (id) => {
        if (partida.estado !== 'dia') return;
        partida.votosDia[socket.id] = id;
        enviarEstado(); 

        if (Object.keys(partida.votosDia).length >= partida.jugadores.filter(j => j.vivo).length) {
            const empatados = calcularMasVotado(partida.votosDia);
            partida.mensajes = []; 
            if (empatados.length === 1) {
                procesarMuertes(empatados, 'noche_inicio', 'linchamiento'); 
            } else {
                partida.mensajes.push("⚖️ El pueblo no ha logrado ponerse de acuerdo. Hay un empate y nadie es linchado hoy.");
                partida.estado = 'noche_inicio';
                avanzarFaseNoche('inicio');
            }
        }
    });

    socket.on('reiniciarPartida', () => {
        if (partida.estado !== 'fin') return;
        partida.estado = 'lobby';
        partida.ronda = 0;
        partida.enamorados = [];
        partida.brujaPociones = { vida: true, muerte: true };
        partida.votosLobos = {};
        partida.votosDia = {};
        partida.victimaLobos = null;
        partida.victimaBruja = null;
        partida.brujaCuro = false;
        partida.cazadorVengando = null;
        partida.estadoSiguiente = null;
        partida.mensajes = [];
        partida.jugadores.forEach(j => { j.vivo = true; j.rol = 'Asignando...'; });
        enviarEstado();
    });

    socket.on('disconnect', () => {
        const jugador = partida.jugadores.find(j => j.id === socket.id);
        partida.jugadores = partida.jugadores.filter(j => j.id !== socket.id);
        
        if (partida.estado !== 'lobby' && partida.estado !== 'fin') {
            partida.mensajes.push(`🔌 ${jugador ? jugador.nombre : 'Un jugador'} se ha desconectado.`);
            if (comprobarVictoria()) { enviarEstado(); return; }
            
            if (partida.estado === 'noche_cupido' && rolesVivos('Cupido') === 0) avanzarFaseNoche('cupido');
            else if (partida.estado === 'noche_vidente' && rolesVivos('Vidente') === 0) avanzarFaseNoche('vidente');
            else if (partida.estado === 'noche_lobos') {
                if (rolesVivos('Lobo') === 0) avanzarFaseNoche('lobos');
                else evaluarVotosLobos();
            }
            else if (partida.estado === 'noche_bruja' && rolesVivos('Bruja') === 0) avanzarFaseNoche('bruja');
            else if (partida.estado === 'venganza_cazador' && partida.cazadorVengando === socket.id) {
                partida.cazadorVengando = null;
                partida.mensajes.push("💨 El Cazador desapareció antes de poder apretar el gatillo.");
                partida.estado = partida.estadoSiguiente;
                if (partida.estado === 'dia') partida.mensajes.push("☀️ Ha amanecido en el pueblo. Es hora de debatir y votar.");
                else if (partida.estado === 'noche_inicio') { avanzarFaseNoche('inicio'); return; }
            }
            else if (partida.estado === 'dia') {
                if (Object.keys(partida.votosDia).length >= partida.jugadores.filter(j => j.vivo).length) {
                    const empatados = calcularMasVotado(partida.votosDia);
                    partida.mensajes = []; 
                    if (empatados.length === 1) {
                        procesarMuertes(empatados, 'noche_inicio', 'linchamiento'); 
                    } else {
                        partida.mensajes.push("⚖️ El pueblo no ha logrado ponerse de acuerdo. Hay un empate y nadie es linchado hoy.");
                        partida.estado = 'noche_inicio';
                        avanzarFaseNoche('inicio');
                    }
                }
            }
        }
        enviarEstado();
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
    console.log(`Servidor activo en el puerto ${PORT}`);
});