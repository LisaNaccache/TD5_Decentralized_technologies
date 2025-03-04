import bodyParser from "body-parser";
import express from "express";
import {BASE_NODE_PORT} from "../config";
import {NodeState, Value} from "../types";

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

    // TODO implement this
    // this route allows retrieving the current status of the node
    // node.get("/status", (req, res) => {});
    // Route pour vérifier le statut du nœud
    node.get("/status", (req, res) => {
        if (isFaulty) {
            return res.status(500).send("faulty");
        }
        return res.status(200).send("live");
    });

    // TODO implement this
    // this route allows the node to receive messages from other nodes
    // node.post("/message", (req, res) => {});
    node.post("/message", (req, res) => {
        if (state.killed) {
            return res.status(400).send("Node is stopped");
        }

        const {sender, value, step} = req.body;

        if (!isFaulty && !state.decided) {
            state.k = step;
            if (value !== "?") {
                state.x = value;
            }
        }

        return res.status(200).send("Message received");
    });

    // TODO implement this
    // this route is used to start the consensus algorithm
    // node.get("/start", async (req, res) => {});
    node.get("/start", async (req, res) => {
        if (state.killed) {
            return res.status(400).send("Node is stopped");
        }

        if (!nodesAreReady()) {
            return res.status(400).send("Nodes are not ready");
        }

        state.k = 0;
        let decision = false;

        while (!decision && state.k < 10) {
            // Étape 1: Chaque nœud envoie sa valeur aux autres
            for (let i = 0; i < N; i++) {
                if (i !== nodeId) {
                    await fetch(`http://localhost:${BASE_NODE_PORT + i}/message`, {
                        method: "POST",
                        headers: {"Content-Type": "application/json"},
                        body: JSON.stringify({
                            sender: nodeId,
                            value: state.x ?? "?",
                            step: state.k,
                        }),
                    });
                }
            }

            // Étape 2: Vérifier si un consensus est atteint
            if (state.x !== null && state.x !== "?") {
                state.decided = true;
                decision = true;
            } else {
                state.k++;
            }
        }

        return res.status(200).send("Consensus started");
    });

    // TODO implement this
    // this route is used to stop the consensus algorithm
    // node.get("/stop", async (req, res) => {});
    node.get("/stop", async (req, res) => {
        state.killed = true;
        return res.status(200).send("Node stopped");
    });


    // TODO implement this
    // get the current state of a node
    // node.get("/getState", (req, res) => {});
    node.get("/getState", (req, res) => {
        return res.json(state);
    });

    // start the server
    const server = node.listen(BASE_NODE_PORT + nodeId, async () => {
        console.log(
            `Node ${nodeId} is listening on port ${BASE_NODE_PORT + nodeId}`
        );

        // the node is ready
        setNodeIsReady(nodeId);
    });

    return server;
}
