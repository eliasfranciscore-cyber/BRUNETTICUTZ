/* Essentials → «Inventario»: stock, movimientos y cuadre (ESQUELETO).

   TODO(T7 · Essentials + Vender + Inventario, ola C): portar InventoryModule de
   PimpStudio (35e44d6 src/components/InventoryModule.jsx) sin nada de comisión
   y con el chip Publicado/Oculto (un solo interruptor = `active`). Se ve solo
   con FEATURES.inventory.

   Datos (ver api-contract.md):
     GET  /api/services?scope=inventory[&productId=]
     POST /api/services?scope=inventory { productId, kind, qty, reason, unitCost? }
                                        | { productId, action:'reconcile' }
   products.stock es la verdad: la vista muestra el desfase contra el libro de
   movimientos y "cuadrar" inserta un `ajuste`; nunca reescribe el stock.

   Lo que ya deja listo Dashboard.jsx en `ctx`: admin, authHeaders, pushToast,
   loadSellable (tras un movimiento el vendible cambia), products/setProducts
   (el catálogo de la pestaña, para reflejar el stock nuevo).
   Mientras tanto no dibuja nada. */
export default function InventoryModule({ ctx }) {
  return null
}
