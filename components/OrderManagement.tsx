import { useState, useEffect, forwardRef, useImperativeHandle } from 'react'
import { useWallet, useConnection } from '@solana/wallet-adapter-react'
import { VersionedTransaction } from '@solana/web3.js'

interface JupiterOrder {
  publicKey: string
  account: {
    inputMint: string
    outputMint: string
    makingAmount: string
    takingAmount: string
    createdAt: string
    maker: string
  }
}

interface OrderManagementProps {
  onOrderCancelled?: (orderIds: string[]) => void
}

interface OrderManagementRef {
  refreshOrders: () => void
}

const OrderManagement = forwardRef<OrderManagementRef, OrderManagementProps>(
  ({ onOrderCancelled }, ref) => {
  const { publicKey, signTransaction } = useWallet()
  const { connection } = useConnection()
  
  const [orders, setOrders] = useState<JupiterOrder[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [isCancellingInProgress, setIsCancellingInProgress] = useState(false)
  const [cancellingOrderIds, setCancellingOrderIds] = useState<string[]>([])
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  const fetchOpenOrders = async () => {
    if (!publicKey) return

    setIsLoading(true)
    setErrorMessage(null)

    try {
      const response = await fetch(`/api/open-orders?wallet=${publicKey.toString()}`)
      
      if (!response.ok) {
        const errorText = await response.text()
        throw new Error(`Failed to fetch orders: ${response.status} ${errorText}`)
      }

      const data = await response.json()
      setOrders(data.orders || [])
      
    } catch (error: any) {
      setErrorMessage(error.message || 'Failed to fetch orders')
    } finally {
      setIsLoading(false)
    }
  }

  const pollForOrderCancellation = async (orderIdsToCheck: string[]) => {
    const checkOrders = async (): Promise<boolean> => {
      try {
        const response = await fetch(`/api/open-orders?wallet=${publicKey!.toString()}`)
        if (!response.ok) return false
        
        const data = await response.json()
        const currentOrderIds = (data.orders || []).map((order: JupiterOrder) => order.publicKey)
        
        const stillExists = orderIdsToCheck.some(orderId => currentOrderIds.includes(orderId))
        
        if (!stillExists) {
          return true
        }
        
        return false
      } catch (error) {
        return false
      }
    }

    const maxAttempts = 30
    let attempts = 0
    
    while (attempts < maxAttempts) {
      const cancelled = await checkOrders()
      if (cancelled) {
        await fetchOpenOrders()
        setIsCancellingInProgress(false)
        setCancellingOrderIds([])
        onOrderCancelled?.(orderIdsToCheck)
        return
      }
      
      attempts++
      await new Promise(resolve => setTimeout(resolve, 2000))
    }
    
    await fetchOpenOrders()
    setIsCancellingInProgress(false)
    setCancellingOrderIds([])
  }

  useImperativeHandle(ref, () => ({
    refreshOrders: fetchOpenOrders
  }), [])

  useEffect(() => {
    if (publicKey) {
      fetchOpenOrders()
    } else {
      setOrders([])
    }
  }, [publicKey])

  const formatAmount = (amount: string, decimals: number) => {
    return (parseInt(amount) / Math.pow(10, decimals)).toFixed(decimals === 9 ? 4 : 2)
  }

  const formatTokenName = (mint: string) => {
    if (mint === 'So11111111111111111111111111111111111111112') return 'SOL'
    if (mint === 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v') return 'USDC'
    return `${mint.slice(0, 4)}...${mint.slice(-4)}`
  }

  const calculatePrice = (order: JupiterOrder) => {
    const inputTokenName = formatTokenName(order.account.inputMint)
    const outputTokenName = formatTokenName(order.account.outputMint)
    const makingAmount = parseInt(order.account.makingAmount) / Math.pow(10, inputTokenName === 'SOL' ? 9 : 6)
    const takingAmount = parseInt(order.account.takingAmount) / Math.pow(10, outputTokenName === 'USDC' ? 6 : 9)
    const priceValue = (takingAmount / makingAmount).toFixed(2)
    return `${priceValue} ${outputTokenName} per ${inputTokenName}`
  }

  const handleCancelOrder = async (orderPublicKey: string) => {
    if (!publicKey || !signTransaction) {
      setErrorMessage('Please connect your wallet first')
      return
    }

    setIsCancellingInProgress(true)
    setCancellingOrderIds([orderPublicKey])
    setErrorMessage(null)

    try {
      const cancelResponse = await fetch("https://api.jup.ag/limit/v2/cancelOrders", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          maker: publicKey.toString(),
          orders: [orderPublicKey],
          computeUnitPrice: "auto",
        }),
      })

      if (!cancelResponse.ok) {
        const errorText = await cancelResponse.text()
        throw new Error(`Jupiter API error: ${cancelResponse.status} ${errorText}`)
      }

      const result = await cancelResponse.json()

      if (result.txs.length === 0) {
        throw new Error('No transactions returned from Jupiter API')
      }

      const signedTransactions: string[] = []
      for (const txBase64 of result.txs) {
        const txBuffer = Buffer.from(txBase64, "base64")
        const tx = VersionedTransaction.deserialize(new Uint8Array(txBuffer))
        
        const signedTx = await signTransaction(tx)
        signedTransactions.push(Buffer.from(signedTx.serialize()).toString('base64'))
      }

      const jitoResponse = await fetch('/api/submit-cancel-bundle', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          signedTransactions,
          orderIds: [orderPublicKey]
        }),
      })

      if (!jitoResponse.ok) {
        const errorText = await jitoResponse.text()
        throw new Error(`Jito bundling error: ${jitoResponse.status} ${errorText}`)
      }

      const jitoResult = await jitoResponse.json()

      pollForOrderCancellation([orderPublicKey])

    } catch (error: any) {
      setErrorMessage(error.message || 'Failed to cancel order')
      setIsCancellingInProgress(false)
      setCancellingOrderIds([])
    }
  }

  const handleCancelAllOrders = async () => {
    if (!publicKey || !signTransaction) {
      setErrorMessage('Please connect your wallet first')
      return
    }

    if (orders.length === 0) {
      setErrorMessage('No orders to cancel')
      return
    }

    const allOrderIds = orders.map(order => order.publicKey)
    setIsCancellingInProgress(true)
    setCancellingOrderIds(allOrderIds)
    setErrorMessage(null)

    try {
      const cancelResponse = await fetch("https://api.jup.ag/limit/v2/cancelOrders", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          maker: publicKey.toString(),
          computeUnitPrice: "auto",
        }),
      })

      if (!cancelResponse.ok) {
        const errorText = await cancelResponse.text()
        throw new Error(`Jupiter API error: ${cancelResponse.status} ${errorText}`)
      }

      const result = await cancelResponse.json()

      if (result.txs.length === 0) {
        throw new Error('No transactions returned from Jupiter API')
      }

      const signedTransactions: string[] = []
      for (const txBase64 of result.txs) {
        const txBuffer = Buffer.from(txBase64, "base64")
        const tx = VersionedTransaction.deserialize(new Uint8Array(txBuffer))
        
        const signedTx = await signTransaction(tx)
        signedTransactions.push(Buffer.from(signedTx.serialize()).toString('base64'))
      }

      const jitoResponse = await fetch('/api/submit-cancel-bundle', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          signedTransactions,
          orderIds: allOrderIds
        }),
      })

      if (!jitoResponse.ok) {
        const errorText = await jitoResponse.text()
        throw new Error(`Jito bundling error: ${jitoResponse.status} ${errorText}`)
      }

      const jitoResult = await jitoResponse.json()

      pollForOrderCancellation(allOrderIds)

    } catch (error: any) {
      setErrorMessage(error.message || 'Failed to cancel all orders')
      setIsCancellingInProgress(false)
      setCancellingOrderIds([])
    }
  }

  if (!publicKey) {
    return (
      <div className="card">
        <h3 className="text-xl font-semibold mb-4">Order Management</h3>
        <div className="bg-yellow-900 border border-yellow-600 rounded-lg p-4">
          <p className="text-yellow-200">Please connect your wallet to view and manage orders</p>
        </div>
      </div>
    )
  }

  return (
    <div className="card relative">
      {isCancellingInProgress && (
        <div className="absolute inset-0 bg-gray-900 bg-opacity-75 rounded-lg flex items-center justify-center z-10">
          <div className="text-center">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-jito mx-auto mb-4"></div>
            <div className="text-white font-medium">
              {cancellingOrderIds.length === 1 ? 'Cancelling Order...' : `Cancelling ${cancellingOrderIds.length} Orders...`}
            </div>
            <div className="text-sm text-gray-300 mt-2">
              Waiting for on-chain confirmation
            </div>
          </div>
        </div>
      )}

      <div className="flex justify-between items-center mb-4">
        <h3 className="text-xl font-semibold">Open Orders ({orders.length})</h3>
        <button
          onClick={fetchOpenOrders}
          disabled={isLoading || isCancellingInProgress}
          className="btn-secondary text-sm disabled:opacity-50"
        >
          {isLoading ? 'Loading...' : 'Refresh'}
        </button>
      </div>

      {errorMessage && (
        <div className="bg-red-900 border border-red-600 rounded-lg p-4 mb-4">
          <p className="text-red-200">{errorMessage}</p>
        </div>
      )}

      {isLoading ? (
        <div className="text-center py-8 text-gray-400">Loading orders...</div>
      ) : orders.length === 0 ? (
        <div className="text-center py-8 text-gray-400">No open orders found</div>
      ) : (
        <>
          <div className="space-y-3 mb-4">
            {orders.map((order) => (
              <div key={order.publicKey} className="bg-gray-700 rounded-lg p-4">
                <div className="flex justify-between items-start">
                  <div className="flex-1">
                    <div className="flex items-center space-x-2 mb-2">
                      <span className="text-sm font-medium">
                        Sell {formatAmount(order.account.makingAmount, 9)} {formatTokenName(order.account.inputMint)}
                      </span>
                      <span className="text-gray-400">→</span>
                      <span className="text-sm font-medium">
                        Buy {formatAmount(order.account.takingAmount, 6)} {formatTokenName(order.account.outputMint)}
                      </span>
                    </div>
                    <div className="text-xs text-gray-400">
                      Price: {calculatePrice(order)}
                    </div>
                    <div className="text-xs text-gray-400">
                      Created: {new Date(parseInt(order.account.createdAt) * 1000).toLocaleString()}
                    </div>
                    <div className="text-xs text-gray-400 break-all mt-1">
                      Order ID: {order.publicKey}
                    </div>
                  </div>
                  <button
                    onClick={() => handleCancelOrder(order.publicKey)}
                    disabled={isCancellingInProgress}
                    className="btn-secondary text-sm ml-4 disabled:opacity-50"
                  >
                    {cancellingOrderIds.includes(order.publicKey) ? 'Cancelling...' : 'Cancel'}
                  </button>
                </div>
              </div>
            ))}
          </div>

          <button
            onClick={handleCancelAllOrders}
            disabled={isCancellingInProgress || orders.length === 0}
            className="btn-secondary w-full disabled:opacity-50"
          >
            {isCancellingInProgress && cancellingOrderIds.length > 1 
              ? `Cancelling All Orders (${cancellingOrderIds.length})...` 
              : `Cancel All Orders (${orders.length})`}
          </button>
        </>
      )}
    </div>
  )
})

OrderManagement.displayName = 'OrderManagement'

export default OrderManagement 