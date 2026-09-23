#!/bin/bash
# cluster-health.sh — Monitora saúde do cluster Mirror
# Uso: ./cluster-health.sh
# Execute em qualquer VPS para ver status de todos

set -e

# IPs dos VPSs no cluster (edite aqui)
VPS_IPS=(
    "VPS1_IP"
    "VPS2_IP"
    "VPS3_IP"
)

VPS_NAMES=(
    "VPS-1"
    "VPS-2"
    "VPS-3"
)

echo "╔══════════════════════════════════════════════╗"
echo "║        Mirror Cluster Health              ║"
echo "╚══════════════════════════════════════════════╝"
echo ""

TOTAL_ONLINE=0
TOTAL_USERS=0

for i in "${!VPS_IPS[@]}"; do
    IP="${VPS_IPS[$i]}"
    NAME="${VPS_NAMES[$i]}"

    if [ "$IP" = "VPS1_IP" ] || [ "$IP" = "VPS2_IP" ] || [ "$IP" = "VPS3_IP" ]; then
        echo "[$NAME] ⚠  IP não configurado ($IP)"
        continue
    fi

    RESPONSE=$(curl -s --max-time 5 "http://${IP}:7000/health" 2>/dev/null)

    if [ -z "$RESPONSE" ]; then
        echo "[$NAME] ❌ OFFLINE ($IP)"
        continue
    fi

    OK=$(echo "$RESPONSE" | python3 -c "import sys,json; print(json.load(sys.stdin).get('ok', False))" 2>/dev/null)
    if [ "$OK" != "True" ]; then
        echo "[$NAME] ⚠  RESPONDENDO MAS COM ERRO ($IP)"
        continue
    fi

    HEAP=$(echo "$RESPONSE" | python3 -c "import sys,json; print(json.load(sys.stdin)['memory']['heap'])" 2>/dev/null)
    RSS=$(echo "$RESPONSE" | python3 -c "import sys,json; print(json.load(sys.stdin)['memory']['rss'])" 2>/dev/null)
    UPTIME=$(echo "$RESPONSE" | python3 -c "import sys,json; u=json.load(sys.stdin)['uptime']; print(f'{u//3600}h{(u%3600)//60}m')" 2>/dev/null)

    echo "[$NAME] ✅ ONLINE ($IP)"
    echo "        RAM: ${RSS}MB RSS / ${HEAP}MB heap | Uptime: ${UPTIME}"

    TOTAL_ONLINE=$((TOTAL_ONLINE + 1))
done

echo ""
echo "───────────────────────────────────────────────"
echo "Nodes online: $TOTAL_ONLINE / ${#VPS_IPS[@]}"

if [ "$TOTAL_ONLINE" -eq "${#VPS_IPS[@]}" ]; then
    echo "Status: ✅ CLUSTER SAUDÁVEL"
elif [ "$TOTAL_ONLINE" -gt 0 ]; then
    echo "Status: ⚠  ALGUNS NODES OFFLINE"
else
    echo "Status: ❌ TODOS OFFLINE"
fi
