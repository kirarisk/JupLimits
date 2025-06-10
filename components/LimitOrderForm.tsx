import { useState, useEffect } from 'react'
import { useWallet, useConnection } from '@solana/wallet-adapter-react'
import { PublicKey, VersionedTransaction } from '@solana/web3.js'

interface LimitOrderFormProps {
  onOrderCreated?: (orderId: string) => void
}

interface TokenHolding {
  mint: string
  name: string
  symbol: string
  decimals: number
  balance: number
  uiAmount: number
}

const POPULAR_TOKENS = [
  { mint: 'So11111111111111111111111111111111111111112', symbol: 'SOL', name: 'Solana', decimals: 9 },
  { mint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', symbol: 'USDC', name: 'USD Coin', decimals: 6 },
  { mint: 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB', symbol: 'USDT', name: 'Tether USD', decimals: 6 },
  { mint: 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263', symbol: 'BONK', name: 'Bonk', decimals: 5 },
  { mint: 'JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN', symbol: 'JUP', name: 'Jupiter', decimals: 6 },
]

export default function LimitOrderForm({ onOrderCreated }: LimitOrderFormProps) {
  const { publicKey, signTransaction } = useWallet()
  const { connection } = useConnection()
  
  const [inputMint, setInputMint] = useState('So11111111111111111111111111111111111111112') // SOL
  const [outputMint, setOutputMint] = useState('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v') // USDC
  const [makingAmount, setMakingAmount] = useState('0.05')
  const [price, setPrice] = useState('159.55')
  const [isCreatingOrder, setIsCreatingOrder] = useState(false)
  const [lastOrderId, setLastOrderId] = useState<string | null>(null)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  
  // Token selection state
  const [userHoldings, setUserHoldings] = useState<TokenHolding[]>([])
  const [isLoadingHoldings, setIsLoadingHoldings] = useState(false)
  const [showCustomInputMint, setShowCustomInputMint] = useState(false)
  const [showCustomOutputMint, setShowCustomOutputMint] = useState(false)
  const [customInputMint, setCustomInputMint] = useState('')
  const [customOutputMint, setCustomOutputMint] = useState('')

  // Fetch user's token holdings
  const fetchUserHoldings = async () => {
    if (!publicKey) return

    setIsLoadingHoldings(true)
    try {
      // Get token accounts
      const tokenAccounts = await connection.getTokenAccountsByOwner(publicKey, {
        programId: new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA')
      })

      // Get SOL balance
      const solBalance = await connection.getBalance(publicKey)
      
      const holdings: TokenHolding[] = [
        {
          mint: 'So11111111111111111111111111111111111111112',
          name: 'Solana',
          symbol: 'SOL',
          decimals: 9,
          balance: solBalance,
          uiAmount: solBalance / 1e9
        }
      ]

      // Process token accounts
      for (const account of tokenAccounts.value) {
        try {
          // Get the parsed account info which includes the mint
          const parsedAccountInfo = await connection.getParsedAccountInfo(account.pubkey)
          
          if (parsedAccountInfo.value?.data && 'parsed' in parsedAccountInfo.value.data) {
            const tokenAccountData = parsedAccountInfo.value.data.parsed.info
            const mintStr = tokenAccountData.mint
            const balance = tokenAccountData.tokenAmount
            
            // Only include accounts with positive balances
            if (balance.uiAmount && balance.uiAmount > 0) {
              // Try to find token info from popular tokens
              const popularToken = POPULAR_TOKENS.find(t => t.mint === mintStr)
              
              holdings.push({
                mint: mintStr,
                name: popularToken?.name || `Token ${mintStr.slice(0, 4)}...`,
                symbol: popularToken?.symbol || mintStr.slice(0, 6),
                decimals: balance.decimals,
                balance: parseInt(balance.amount),
                uiAmount: balance.uiAmount
              })
            }
          }
        } catch (e) {
          console.warn('Failed to parse token account:', account.pubkey.toString(), e)
          // Skip failed token accounts
        }
      }

      setUserHoldings(holdings)
    } catch (error) {
      console.error('Error fetching holdings:', error)
    } finally {
      setIsLoadingHoldings(false)
    }
  }

  useEffect(() => {
    if (publicKey) {
      fetchUserHoldings()
    }
  }, [publicKey])

  const getTokenInfo = (mint: string) => {
    const holding = userHoldings.find(h => h.mint === mint)
    if (holding) return holding
    
    const popular = POPULAR_TOKENS.find(t => t.mint === mint)
    if (popular) return { ...popular, balance: 0, uiAmount: 0 }
    
    return { mint, symbol: mint.slice(0, 6), name: `${mint.slice(0, 4)}...`, decimals: 9, balance: 0, uiAmount: 0 }
  }

  const calculateTakingAmount = () => {
    const inputInfo = getTokenInfo(inputMint)
    const outputInfo = getTokenInfo(outputMint)
    const inputAmount = parseFloat(makingAmount || '0')
    const priceValue = parseFloat(price || '0')
    return (inputAmount * priceValue).toFixed(outputInfo.decimals)
  }

  const handleInputMintChange = (mint: string) => {
    if (mint === 'custom') {
      setShowCustomInputMint(true)
    } else {
      setInputMint(mint)
      setShowCustomInputMint(false)
      setCustomInputMint('')
    }
  }

  const handleOutputMintChange = (mint: string) => {
    if (mint === 'custom') {
      setShowCustomOutputMint(true)
    } else {
      setOutputMint(mint)
      setShowCustomOutputMint(false)
      setCustomOutputMint('')
    }
  }

  const handleCustomInputMintSubmit = () => {
    try {
      new PublicKey(customInputMint) // Validate mint address
      setInputMint(customInputMint)
      setShowCustomInputMint(false)
    } catch (e) {
      setErrorMessage('Invalid input mint address')
    }
  }

  const handleCustomOutputMintSubmit = () => {
    try {
      new PublicKey(customOutputMint) // Validate mint address
      setOutputMint(customOutputMint)
      setShowCustomOutputMint(false)
    } catch (e) {
      setErrorMessage('Invalid output mint address')
    }
  }

  const handleCreateOrder = async () => {
    if (!publicKey || !signTransaction) {
      setErrorMessage('Please connect your wallet first')
      return
    }

    if (!makingAmount || !price) {
      setErrorMessage('Please enter both amount and price')
      return
    }

    setIsCreatingOrder(true)
    setErrorMessage(null)

    try {
      const inputInfo = getTokenInfo(inputMint)
      const outputInfo = getTokenInfo(outputMint)
      
      const makingAmountLamports = Math.floor(parseFloat(makingAmount) * Math.pow(10, inputInfo.decimals)).toString()
      const takingAmountUnits = Math.floor(parseFloat(calculateTakingAmount()) * Math.pow(10, outputInfo.decimals)).toString()

      console.log(`Creating order: ${makingAmount} ${inputInfo.symbol} (${makingAmountLamports} units) for ${calculateTakingAmount()} ${outputInfo.symbol} (${takingAmountUnits} units)`)

      // Step 1: Get transaction from Jupiter API
      console.log('Calling Jupiter API to create order...')
      const createOrderResponse = await fetch("https://api.jup.ag/limit/v2/createOrder", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          inputMint,
          outputMint,
          maker: publicKey.toString(),
          payer: publicKey.toString(),
          params: {
            makingAmount: makingAmountLamports,
            takingAmount: takingAmountUnits,
          },
          computeUnitPrice: "auto",
          wrapAndUnwrapSol: inputMint === 'So11111111111111111111111111111111111111112' || outputMint === 'So11111111111111111111111111111111111111112',
        }),
      })

      if (!createOrderResponse.ok) {
        const errorText = await createOrderResponse.text()
        throw new Error(`Jupiter API error: ${createOrderResponse.status} ${errorText}`)
      }

      const jupiterResult = await createOrderResponse.json()
      console.log("Jupiter API response received, order:", jupiterResult.order)

      // Step 2: Deserialize transaction and sign with user's wallet
      const txBuffer = Buffer.from(jupiterResult.tx, "base64")
      const versionedTx = VersionedTransaction.deserialize(new Uint8Array(txBuffer))
      
      console.log('Requesting wallet signature...')
      const signedTx = await signTransaction(versionedTx)
      console.log('Transaction signed by user wallet')

      // Step 3: Send transaction through Jito bundling (mandatory)
      console.log('Sending signed transaction through Jito bundling...')
      const jitoResponse = await fetch('/api/submit-jito-bundle', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          signedTransaction: Buffer.from(signedTx.serialize()).toString('base64'),
          orderId: jupiterResult.order,
          makingAmount: parseInt(makingAmountLamports),
          inputMint: inputMint // Pass input mint for fee calculation
        }),
      })

      if (!jitoResponse.ok) {
        const errorText = await jitoResponse.text()
        throw new Error(`Jito bundling error: ${jitoResponse.status} ${errorText}`)
      }

      const jitoResult = await jitoResponse.json()
      console.log('Jito bundle submitted successfully:', jitoResult)

      // Log bundle ID prominently
      if (jitoResult.bundleId) {
        console.log('🎉 ORDER CREATION BUNDLED!')
        console.log('📦 Bundle ID:', jitoResult.bundleId)
        console.log('🆔 Order ID:', jupiterResult.order)
        console.log('🔗 Transaction Signature:', jitoResult.signature)
      }

      // Success!
      setLastOrderId(jupiterResult.order)
      onOrderCreated?.(jupiterResult.order)
      
      // Reset form
      setMakingAmount('')
      setPrice('')

    } catch (error: any) {
      console.error('Error creating order:', error)
      setErrorMessage(error.message || 'Failed to create order')
    } finally {
      setIsCreatingOrder(false)
    }
  }

  const inputTokenInfo = getTokenInfo(inputMint)
  const outputTokenInfo = getTokenInfo(outputMint)

  return (
    <div className="card max-w-lg mx-auto">
      <h2 className="text-2xl font-bold mb-6 text-center">Create Jupiter Limit Order</h2>
      
      {!publicKey && (
        <div className="bg-yellow-900 border border-yellow-600 rounded-lg p-4 mb-6">
          <p className="text-yellow-200">Please connect your wallet to create limit orders</p>
        </div>
      )}

      <div className="space-y-4">
        {/* Input Token Selection */}
        <div>
          <label className="block text-sm font-medium mb-2">Sell Token</label>
          <select
            value={showCustomInputMint ? 'custom' : inputMint}
            onChange={(e) => handleInputMintChange(e.target.value)}
            className="input w-full mb-2"
            disabled={isCreatingOrder}
          >
            <optgroup label="Your Holdings">
              {userHoldings.map((holding) => (
                <option key={holding.mint} value={holding.mint}>
                  {holding.symbol} - {holding.uiAmount.toFixed(4)} available
                </option>
              ))}
            </optgroup>
            <optgroup label="Popular Tokens">
              {POPULAR_TOKENS.filter(token => !userHoldings.find(h => h.mint === token.mint)).map((token) => (
                <option key={token.mint} value={token.mint}>
                  {token.symbol} - {token.name}
                </option>
              ))}
            </optgroup>
            <option value="custom">🔧 Custom Mint Address</option>
          </select>
          
          {showCustomInputMint && (
            <div className="flex space-x-2">
              <input
                type="text"
                placeholder="Enter mint address..."
                value={customInputMint}
                onChange={(e) => setCustomInputMint(e.target.value)}
                className="input flex-1"
              />
              <button
                onClick={handleCustomInputMintSubmit}
                className="btn-secondary"
              >
                Set
              </button>
            </div>
          )}
          
          <div className="text-xs text-gray-400 mt-1">
            Available: {inputTokenInfo.uiAmount.toFixed(4)} {inputTokenInfo.symbol}
          </div>
        </div>

        {/* Output Token Selection */}
        <div>
          <label className="block text-sm font-medium mb-2">Buy Token</label>
          <select
            value={showCustomOutputMint ? 'custom' : outputMint}
            onChange={(e) => handleOutputMintChange(e.target.value)}
            className="input w-full mb-2"
            disabled={isCreatingOrder}
          >
            <optgroup label="Popular Tokens">
              {POPULAR_TOKENS.map((token) => (
                <option key={token.mint} value={token.mint}>
                  {token.symbol} - {token.name}
                </option>
              ))}
            </optgroup>
            <option value="custom">🔧 Custom Mint Address</option>
          </select>
          
          {showCustomOutputMint && (
            <div className="flex space-x-2">
              <input
                type="text"
                placeholder="Enter mint address..."
                value={customOutputMint}
                onChange={(e) => setCustomOutputMint(e.target.value)}
                className="input flex-1"
              />
              <button
                onClick={handleCustomOutputMintSubmit}
                className="btn-secondary"
              >
                Set
              </button>
            </div>
          )}
        </div>

        {/* Amount Input */}
        <div>
          <label className="block text-sm font-medium mb-2">
            Sell Amount ({inputTokenInfo.symbol})
          </label>
          <input
            type="number"
            step={`0.${'0'.repeat(Math.max(0, inputTokenInfo.decimals - 3))}1`}
            placeholder="0.05"
            value={makingAmount}
            onChange={(e) => setMakingAmount(e.target.value)}
            className="input w-full"
            disabled={isCreatingOrder}
          />
        </div>

        {/* Price Input */}
        <div>
          <label className="block text-sm font-medium mb-2">
            Limit Price - Sell at ({outputTokenInfo.symbol} per {inputTokenInfo.symbol})
          </label>
          <input
            type="number"
            step={`0.${'0'.repeat(Math.max(0, outputTokenInfo.decimals - 2))}1`}
            placeholder="159.55"
            value={price}
            onChange={(e) => setPrice(e.target.value)}
            className="input w-full"
            disabled={isCreatingOrder}
          />
        </div>

        {/* Order Summary */}
        <div className="bg-gray-700 rounded-lg p-4">
          <div className="text-sm text-gray-300 mb-2">Order Summary:</div>
          <div className="text-sm">
            Sell: <span className="font-semibold">{makingAmount || '0'} {inputTokenInfo.symbol}</span>
          </div>
          <div className="text-sm">
            Buy: <span className="font-semibold">{calculateTakingAmount()} {outputTokenInfo.symbol}</span>
          </div>
          <div className="text-sm">
            Rate: <span className="font-semibold">{price || '0'} {outputTokenInfo.symbol} per {inputTokenInfo.symbol}</span>
          </div>
          <div className="text-sm mt-2 text-gray-400">
            Signer: <span className="font-semibold">Your Wallet</span> 
            {publicKey && (
              <span className="ml-2">({publicKey.toString().slice(0, 4)}...{publicKey.toString().slice(-4)})</span>
            )}
          </div>
          <div className="text-sm mt-1 text-yellow-400">
            💳 <span className="font-semibold">1% Fee: {((parseFloat(makingAmount || '0') * 0.01) || 0).toFixed(4)} {inputTokenInfo.symbol}</span>
          </div>
        </div>

        {errorMessage && (
          <div className="bg-red-900 border border-red-600 rounded-lg p-4">
            <p className="text-red-200">{errorMessage}</p>
          </div>
        )}

        {lastOrderId && (
          <div className="bg-green-900 border border-green-600 rounded-lg p-4">
            <p className="text-green-200">Order created successfully!</p>
            <p className="text-xs text-green-300 break-all">Order ID: {lastOrderId}</p>
          </div>
        )}

        <button
          onClick={handleCreateOrder}
          disabled={!publicKey || isCreatingOrder || !makingAmount || !price}
          className="btn-primary w-full disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {isCreatingOrder ? 'Creating Order...' : `Create Limit Order`}
        </button>
        
        {isLoadingHoldings && (
          <div className="text-center text-sm text-gray-400">
            Loading your token holdings...
          </div>
        )}
      </div>
    </div>
  )
} 