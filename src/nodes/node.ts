import bodyParser from "body-parser";
import express from "express";
import { BASE_NODE_PORT } from "../config";
import { NodeMessage, NodeState, Value } from "../types";

export async function node(
    nodeId: number, // the ID of the node
    N: number, // total number of nodes in the network
    F: number, // number of faulty nodes in the network
    initialValue: Value, // initial value of the node
    isFaulty: boolean, // true if the node is faulty, false otherwise
    nodesAreReady: () => boolean, // used to know if all nodes are ready to receive requests
    setNodeIsReady: (index: number) => void // this should be called when the node is started and ready to receive requests
) {
    const node = express();
    node.use(express.json());
    node.use(bodyParser.json());

    let state: NodeState = {
        killed: false,
        x: isFaulty ? null : initialValue,
        decided: null,
        k: null,
    };

    // Stockage des messages reçus
    const messageBuffer: Record<number, Record<number, NodeMessage[]>> = {};

    function saveMessage(msg: NodeMessage): void {
        const { k, phase } = msg;
        if (!messageBuffer[k]) {
            messageBuffer[k] = { 1: [], 2: [] };
        }
        if (!messageBuffer[k][phase].some(existingMsg => existingMsg.nodeId === msg.nodeId)) {
            messageBuffer[k][phase].push(msg);
        }
    }

    async function broadcastMessage(phase: 1 | 2, k: number, x: Value | null) {
        for (let i = 0; i < N; i++) {
            fetch(`http://localhost:${BASE_NODE_PORT + i}/message`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ phase, nodeId, k, x }),
            }).catch(() => {});
        }
    }

    function countValues(messages: NodeMessage[]): Record<Value, number> {
        return messages.reduce((acc, msg) => {
            if (msg.x !== null) acc[msg.x] += 1;
            return acc;
        }, { 0: 0, 1: 0, "?": 0 });
    }

    // Route pour vérifier le statut du nœud
    node.get("/status", (req, res) => {
        return isFaulty ? res.status(500).send("faulty") : res.status(200).send("live");
    });

    // Route pour recevoir les messages des autres nœuds
    node.post("/message", async (req, res) => {
        const { phase, nodeId, k, x } = req.body;

        if (isFaulty) {
            state.k = null;
            state.x = null;
            state.decided = null;
            return res.status(500).json({ message: `Node is faulty` });
        }

        if (state.killed) {
            return res.status(500).json({ message: `Node is stopped` });
        }

        saveMessage({ phase, nodeId, k, x });

        // Phase 1 - Premier échange
        if (phase === 1) {
            const received = messageBuffer[k][phase];
            if (received.length >= N - F) {
                const valueCounts = countValues(received);
                const majority = Object.entries(valueCounts)
                    .filter(([_, count]) => count > N / 2)
                    .map(([key]) => (key === "0" ? 0 : key === "1" ? 1 : null))[0];

                state.x = majority !== undefined ? majority : state.x;

                // Diffusion du message de phase 2
                await broadcastMessage(2, k, state.x);
                return res.status(200).json({ message: "Phase 1 terminée" });
            }
        }

        // Phase 2 - Décision finale
        else if (phase === 2) {
            const received = messageBuffer[k][phase];
            if (received.length >= N - F) {
                const valueCounts = countValues(received);
                const majorDecision = Object.entries(valueCounts)
                    .filter(([_, count]) => count > 2 * F)
                    .map(([key]) => key === "0" ? 0 : key === "1" ? 1 : null)[0];

                if (majorDecision === 0 || majorDecision === 1) {
                    state.x = majorDecision;
                    state.decided = true;
                    return res.status(200).json({ message: "Consensus atteint en Phase 2" });
                }
                else if (valueCounts["0"] >= F + 1) {
                    state.x = 0;
                    state.decided = true;
                } else if (valueCounts["1"] >= F + 1) {
                    state.x = 1;
                    state.decided = true;
                } else {
                    state.x = Math.random() > 0.5 ? 1 : 0;
                    state.decided = false;
                }

                state.k = k + 1;
                await broadcastMessage(1, state.k ?? 0, state.x);
                return res.status(200).json({ message: "Prochaine itération (Phase 1)" });
            }
        }

        return res.status(500).json({ message: `Problème sur le nœud ${nodeId}` });
    });

    // Route pour démarrer le consensus
    node.get("/start", async (req, res) => {
        if (!nodesAreReady()) {
            return res.status(400).send("Nodes are not ready");
        }

        if (isFaulty) {
            state.k = null;
            state.x = null;
            state.decided = null;
            return res.status(500).json({ message: `Node is faulty` });
        }

        state.k = 1;
        state.x = initialValue;
        state.decided = false;

        await broadcastMessage(1, state.k, state.x);
        return res.status(200).send("Consensus lancé.");
    });

    // Route pour arrêter le nœud
    node.get("/stop", async (req, res) => {
        state.killed = true;
        return res.status(200).send("Node stopped");
    });

    // Route pour obtenir l'état actuel du nœud
    node.get("/getState", (req, res) => {
        if (isFaulty) {
            return res.json({
                killed: state.killed,
                x: null,
                decided: null,
                k: null,
            });
        }
        if (state.killed) {
            return res.status(500).json({ message: `Node ${nodeId} is stopped` });
        }
        return res.json(state);
    });

    // Démarrer le serveur
    const server = node.listen(BASE_NODE_PORT + nodeId, async () => {
        console.log(`Node ${nodeId} écoute sur le port ${BASE_NODE_PORT + nodeId}`);
        setNodeIsReady(nodeId);
    });

    return server;
}