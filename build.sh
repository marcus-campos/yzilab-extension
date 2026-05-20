#!/usr/bin/env bash
# Empacota a extensão para upload no Chrome Web Store.
#
# Uso:
#   ./build.sh                # bump patch:  0.1.0 -> 0.1.1
#   ./build.sh --minor        # bump minor:  0.1.0 -> 0.2.0
#   ./build.sh --major        # bump major:  0.1.0 -> 1.0.0
#   ./build.sh --version 1.2.3  # fixa a versão explicitamente
#   ./build.sh --no-bump      # mantém a versão atual
#
# Produz dist/animalex-bridge-vX.Y.Z.zip e imprime o SHA-256.

set -euo pipefail

cd "$(dirname "$0")"
MANIFEST="manifest.json"
DIST_DIR="dist"

if [[ ! -f "$MANIFEST" ]]; then
  echo "Erro: $MANIFEST não encontrado." >&2
  exit 1
fi

current=$(grep -o '"version": *"[^"]*"' "$MANIFEST" | head -1 | sed -E 's/.*"([^"]+)"$/\1/')
if [[ -z "$current" ]]; then
  echo "Erro: não consegui ler a versão atual do $MANIFEST." >&2
  exit 1
fi

mode="patch"
explicit=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --patch) mode="patch"; shift ;;
    --minor) mode="minor"; shift ;;
    --major) mode="major"; shift ;;
    --no-bump) mode="none"; shift ;;
    --version)
      explicit="$2"
      mode="explicit"
      shift 2
      ;;
    -h|--help)
      sed -n '2,12p' "$0"
      exit 0
      ;;
    *)
      echo "Opção desconhecida: $1" >&2
      exit 1
      ;;
  esac
done

IFS='.' read -r major minor patch <<<"$current"
major=${major:-0}; minor=${minor:-0}; patch=${patch:-0}

case "$mode" in
  patch) patch=$((patch + 1)) ;;
  minor) minor=$((minor + 1)); patch=0 ;;
  major) major=$((major + 1)); minor=0; patch=0 ;;
  none)  ;;
  explicit) ;;
esac

if [[ "$mode" == "explicit" ]]; then
  if [[ ! "$explicit" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
    echo "Erro: --version deve ser X.Y.Z (ex.: 1.2.3)." >&2
    exit 1
  fi
  next="$explicit"
else
  next="${major}.${minor}.${patch}"
fi

if [[ "$next" != "$current" ]]; then
  tmp="$(mktemp)"
  # substitui apenas a primeira ocorrência de "version" no topo do JSON
  awk -v cur="$current" -v nx="$next" '
    !done && $0 ~ /"version"[[:space:]]*:[[:space:]]*"/ {
      sub("\"" cur "\"", "\"" nx "\"")
      done=1
    }
    { print }
  ' "$MANIFEST" > "$tmp"
  mv "$tmp" "$MANIFEST"
  echo "manifest.json: version $current -> $next"
else
  echo "manifest.json: version mantida em $current"
fi

mkdir -p "$DIST_DIR"
zip_name="animalex-bridge-v${next}.zip"
zip_path="${DIST_DIR}/${zip_name}"
rm -f "$zip_path"

zip -r "$zip_path" . \
  -x ".*" \
  -x ".*/*" \
  -x "*.DS_Store" \
  -x "dist/*" \
  -x "build.sh" \
  -x "README.md" \
  -x "node_modules/*" \
  >/dev/null

if command -v shasum >/dev/null 2>&1; then
  hash=$(shasum -a 256 "$zip_path" | awk '{print $1}')
else
  hash=$(sha256sum "$zip_path" | awk '{print $1}')
fi

size=$(stat -f%z "$zip_path" 2>/dev/null || stat -c%s "$zip_path")

echo ""
echo "✓ Pacote pronto"
echo "  arquivo: $zip_path"
echo "  tamanho: $((size / 1024)) KB"
echo "  sha256:  $hash"
echo ""
echo "Próximos passos:"
echo "  1. Acesse https://chrome.google.com/webstore/devconsole/"
echo "  2. Selecione o item 'Animalex Bridge' (ou crie um novo)"
echo "  3. Upload do arquivo: $zip_path"
echo "  4. Submit for review"
