import type { NextApiRequest, NextApiResponse } from 'next'
import {
  Connection,
  Keypair,
  PublicKey,
  TransactionMessage,
  VersionedTransaction,
  SystemProgram,
} from '@solana/web3.js'
import * as Fs from 'fs'
import bs58 from 'bs58'
import path from 'path'

interface CreateOrderRequest {
  inputMint: string
  outputMint: string
  maker: string
  makingAmount: string
  takingAmount: string
}

interface CreateOrderResponse {
  success: boolean
  orderId?: string
  error?: string
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<CreateOrderResponse>
) {
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'Method not allowed' })
  }

  try {
    const { inputMint, outputMint, maker, makingAmount, takingAmount }: CreateOrderRequest = req.body

    // Try to load the .env file  
    const jitoEnvPath = path.join(process.cwd(), '.env')
    console.log('Looking for .env file at:', jitoEnvPath)
    
    // Try to load the .env file
    let jitoEnv: any = {}
    try {
      const envContent = Fs.readFileSync(jitoEnvPath, 'utf8')
      envContent.split('\n').forEach(line => {
        const [key, ...valueParts] = line.trim().split('=')
        if (key && valueParts.length > 0) {
          jitoEnv[key] = valueParts.join('=')
        }
      })
    } catch (error) {
      console.error('Error reading .env file:', error)
    }

    const authKeypairPath = jitoEnv.AUTH_KEYPAIR_PATH || process.env.AUTH_KEYPAIR_PATH
    const rpcUrl = jitoEnv.RPC_URL || process.env.RPC_URL

    if (!authKeypairPath || !rpcUrl) {
      console.error('Missing environment variables')
      return res.status(500).json({
        success: false,
        error: 'Server configuration missing. Please check AUTH_KEYPAIR_PATH and RPC_URL in .env'
      })
    }

    // Load the authority keypair from array
    let owner: Keypair
    try {
      const keypairData = JSON.parse(authKeypairPath) as number[]
      owner = Keypair.fromSecretKey(new Uint8Array(keypairData))
      console.log('✅ Server keypair loaded successfully:', owner.publicKey.toString())
    } catch (error) {
      console.error('❌ Error parsing auth keypair array:', error)
      return res.status(500).json({ 
        success: false, 
        error: 'Invalid AUTH_KEYPAIR_PATH format. Must be a valid JSON array of numbers.' 
      })
    }

    console.log("Creating Jupiter limit order with Jito bundling...")
    console.log(`Maker: ${maker}`)
    console.log(`Payer: ${owner.publicKey.toString()}`)
    console.log(`Amount: ${makingAmount} lamports -> ${takingAmount} USDC units`)

    // Create Jupiter limit order via API
    const createOrderResponse = await fetch("https://api.jup.ag/limit/v2/createOrder", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        inputMint,
        outputMint,
        maker,
        payer: owner.publicKey.toString(), // Server pays for the transaction
        params: {
          makingAmount,
          takingAmount,
          // expiredAt: null, // No expiration
        },
        computeUnitPrice: "auto",
        wrapAndUnwrapSol: true,
      }),
    })

    if (!createOrderResponse.ok) {
      const errorText = await createOrderResponse.text()
      return res.status(500).json({ 
        success: false, 
        error: `Jupiter API error: ${createOrderResponse.status} ${errorText}` 
      })
    }

    const jupiterResult = await createOrderResponse.json()
    console.log("Jupiter API response received, order:", jupiterResult.order)
    
    // Deserialize and sign the transaction
    const txBuffer = Buffer.from(jupiterResult.tx, "base64")
    const versionedTx = VersionedTransaction.deserialize(new Uint8Array(txBuffer))
    
    // Sign the transaction with server keypair
    versionedTx.sign([owner])

    // Connect to RPC
    const connection = new Connection(rpcUrl, "confirmed")
    const blockHash = await connection.getLatestBlockhash()

    // For now, send the transaction directly (simplified)
    // In production, you'd integrate with the full Jito SDK bundle logic
    try {
      console.log("Sending Jupiter order transaction...")
      const signature = await connection.sendTransaction(versionedTx, {
        skipPreflight: false,
        preflightCommitment: 'confirmed'
      })

      console.log("Transaction sent, signature:", signature)
      
      // Wait for confirmation
      const confirmation = await connection.confirmTransaction(signature, 'confirmed')
      
      if (confirmation.value.err) {
        throw new Error(`Transaction failed: ${confirmation.value.err}`)
      }

      console.log("Transaction confirmed successfully!")

      res.status(200).json({
        success: true,
        orderId: jupiterResult.order
      })

    } catch (sendError: any) {
      console.error("Error sending transaction:", sendError)
      res.status(500).json({
        success: false,
        error: `Transaction failed: ${sendError.message}`
      })
    }

  } catch (error: any) {
    console.error("Error in create-order-jito:", error)
    res.status(500).json({
      success: false,
      error: error.message || 'Internal server error'
    })
  }
} 