import { useState, useRef } from 'react'
import Head from 'next/head'
import WalletConnection from '../components/WalletConnection'
import LimitOrderForm from '../components/LimitOrderForm'
import OrderManagement from '../components/OrderManagement'

export default function Home() {
  const [recentOrders, setRecentOrders] = useState<string[]>([])
  const [cancelledOrders, setCancelledOrders] = useState<string[]>([])
  const orderManagementRef = useRef<{ refreshOrders: () => void } | null>(null)

  const handleOrderCreated = (orderId: string) => {
    setRecentOrders(prev => [orderId, ...prev.slice(0, 4)]) // Keep last 5 orders
    
    // Refresh orders list after creation
    if (orderManagementRef.current) {
      setTimeout(() => {
        orderManagementRef.current?.refreshOrders()
      }, 3000) // Give it 3 seconds for the order to appear on Jupiter's API
    }
  }

  const handleOrderCancelled = (orderIds: string[]) => {
    setCancelledOrders(prev => [...orderIds, ...prev.slice(0, 10)]) // Keep last 10 cancelled orders
  }

  return (
    <>
      <Head>
        <title>Jupiter Limit Orders with Jito</title>
        <meta name="description" content="Create Jupiter limit orders with Jito MEV protection" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <link rel="icon" href="/favicon.ico" />
      </Head>

      <main className="min-h-screen bg-gray-900 py-8">
        <div className="container mx-auto px-4 max-w-6xl">
          <header className="text-center mb-8">
            <h1 className="text-4xl font-bold mb-4">
              <span className="text-jupiter">Jupiter</span> Limit Orders
            </h1>
            <p className="text-gray-400">
              Create and manage limit orders with Jito Bundles
            </p>
          </header>

          <WalletConnection />

          <div className="grid lg:grid-cols-3 gap-8">
            {/* Order Creation */}
            <div className="lg:col-span-1">
              <LimitOrderForm onOrderCreated={handleOrderCreated} />
            </div>

            {/* Order Management */}
            <div className="lg:col-span-2">
              <OrderManagement onOrderCancelled={handleOrderCancelled} ref={orderManagementRef} />
            </div>
          </div>

          {/* Info Section */}
          <div className="grid md:grid-cols-3 gap-6 mt-8">
            {recentOrders.length > 0 && (
              <div className="card">
                <h3 className="text-xl font-semibold mb-4">Recent Orders Created</h3>
                <div className="space-y-2">
                  {recentOrders.map((orderId, index) => (
                    <div key={orderId} className="bg-gray-700 rounded-lg p-3">
                      <div className="text-sm text-gray-300">Order #{index + 1}</div>
                      <div className="text-xs text-gray-400 break-all">{orderId}</div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {cancelledOrders.length > 0 && (
              <div className="card">
                <h3 className="text-xl font-semibold mb-4">Recently Cancelled</h3>
                <div className="space-y-2">
                  {cancelledOrders.slice(0, 5).map((orderId, index) => (
                    <div key={orderId} className="bg-gray-700 rounded-lg p-3">
                      <div className="text-sm text-gray-300">Cancelled #{index + 1}</div>
                      <div className="text-xs text-gray-400 break-all">{orderId}</div>
                    </div>
                  ))}
                </div>
              </div>
            )}



          </div>
        </div>
      </main>
    </>
  )
} 