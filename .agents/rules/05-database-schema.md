# Schema do Banco de Dados (Prisma)

## Visão geral das relações

```
Agency 1──N User
Agency 1──N Property

Property 1──1 Address
Property 1──1 VirtualTour

VirtualTour 1──N Panorama
VirtualTour 1──N View
VirtualTour 1──N Share

Panorama 1──N Hotspot (como origin)
Panorama 1──N Hotspot (como target)
Panorama 1──N CaptureFrame
Panorama 1──N Measurement

Visitor 1──N View
Visitor 1──N Share
```

## Enums

| Enum | Valores |
|---|---|
| `UserType` | `ADMINISTRATOR`, `AGENT` |
| `PropertyType` | `HOUSE`, `APARTMENT`, `LAND`, `COMMERCIAL`, `RURAL`, `OFFICE` |
| `PropertyPurpose` | `SALE`, `RENT`, `SALE_OR_RENT` |
| `PropertyStatus` | `AVAILABLE`, `SOLD`, `RENTED`, `UNAVAILABLE` |
| `VirtualTourStatus` | `DRAFT`, `PUBLISHED`, `ARCHIVED` |
| `TreatmentStatus` | `PENDING`, `PROCESSING`, `DONE`, `FAILED`, `SKIPPED` |

## Models principais

### User
- `id`, `name`, `email` (unique), `password`, `type` (UserType)
- `licenseNumber?` (CRECI, para corretores)
- `agencyId?` → Agency
- Tem N properties e N sessions

### Property
- `id`, `code` (unique), `title`, `description?`, `type`, `purpose`, `price?`, `totalArea?`, `status`
- `agencyId` → Agency (multi-tenant)
- `agentId?` → User
- Tem 1 Address? e 1 VirtualTour?

### VirtualTour
- `id`, `status` (default DRAFT), `propertyId` (unique) → Property
- Tem N Panoramas, N Views, N Shares

### Panorama
- `id`, `roomName`, `imageData` (base64 Text), `order`, `initialPanorama` (bool)
- Campos de geometria de captura: `fittedVfovDeg?`, `bandTopDeg?`, `bandBottomDeg?`
- Campos de tratamento IA: `treatedImageData?`, `treatmentStatus`, `treatmentError?`, `treatmentMeta?`, `treatedAt?`
- `virtualTourId` → VirtualTour
- Tem N Hotspots (origin e target), N CaptureFrames, N Measurements

### Hotspot
- `id`, `label?`, `positionX` (0-1 UV), `positionY` (0-1 UV)
- `originId` → Panorama (de onde aponta)
- `targetId` → Panorama (para onde vai)

### CaptureFrame
- `id`, `index`, `imageData` (base64), quaternion (`qx`, `qy`, `qz`, `qw`)
- `panoramaId` → Panorama
- Unique constraint: `[panoramaId, index]` (reenvio não duplica)

### Measurement
- `id`, `description`, `value`, `unit` (default "m")
- `panoramaId` → Panorama

### Visitor / View / Share (analytics)
- `Visitor`: `sessionId` (unique)
- `View`: `viewedAt`, `durationSeconds?`, `device?` → VirtualTour + Visitor
- `Share`: `sharedAt`, `channel` → VirtualTour + Visitor

## Convenção de coordenadas (hotspots)

- `positionX`: UV horizontal (0–1), mapeado de longitude
- `positionY`: UV vertical (0–1), onde 0 = polo norte (topo), 1 = polo sul
- Fórmula: `theta = positionY * PI` (medido de +Y)
- O `onCanvasClick` emite `positionY = 1 - uv.y` (three.js inverte o V da UV)
- **CUIDADO**: NÃO use `(1 - positionY) * PI` — esse era o bug do eixo espelhado, corrigido em `f7803a4`
