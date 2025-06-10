import { useWallet } from '@solana/wallet-adapter-react'
import { WalletMultiButton } from '@solana/wallet-adapter-react-ui'
import { useEffect, useState } from 'react'

export default function WalletConnection() {
  const { wallet, publicKey, connected } = useWallet()
  const [mounted, setMounted] = useState(false)

  // Ensure this component only renders on the client side
  useEffect(() => {
    setMounted(true)
  }, [])

  if (!mounted) {
    // Return a placeholder that matches the server-side render
    return (
      <div className="flex items-center justify-between p-4 bg-gray-800 rounded-lg mb-6">
        <div className="flex items-center space-x-4">
          <div className="flex items-center space-x-2">
            <div className="w-3 h-3 rounded-full bg-red-500" />
            <span className="text-sm font-medium">Not Connected</span>
          </div>
        </div>
        <div className="bg-jupiter text-black font-semibold py-2 px-4 rounded-lg">
          Select Wallet
        </div>
      </div>
    )
  }

  return (
    <div className="flex items-center justify-between p-4 bg-gray-800 rounded-lg mb-6">
      <div className="flex items-center space-x-4">
        <div className="flex items-center space-x-2">
          <div className={`w-3 h-3 rounded-full ${connected ? 'bg-green-500' : 'bg-red-500'}`} />
          <span className="text-sm font-medium">
            {connected ? 'Connected' : 'Not Connected'}
          </span>
        </div>
        {connected && publicKey && (
          <div className="text-sm text-gray-400">
            {publicKey.toString().slice(0, 4)}...{publicKey.toString().slice(-4)}
          </div>
        )}
      </div>
      <WalletMultiButton className="!bg-jupiter !text-black hover:!bg-opacity-90" />
    </div>
  )
} 