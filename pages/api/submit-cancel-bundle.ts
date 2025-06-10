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

// Import Jito SDK components from npm package
import { searcherClient, SearcherClient } from 'jito-ts/dist/sdk/block-engine/searcher'
import { Bundle } from 'jito-ts/dist/sdk/block-engine/types'

interface SubmitCancelBundleRequest {
  signedTransactions: string[] // Array of base64 encoded signed transactions
  orderIds: string[]
}

interface SubmitCancelBundleResponse {
  success: boolean
  bundleId?: string
  signatures?: string[]
  error?: string
}

const getRandomTipAccountAddress = async (
  searcherClient: SearcherClient,
) => {
  const accountResult = await searcherClient.getTipAccounts()
  if (!accountResult.ok) {
    throw new Error(`Failed to get tip accounts: ${accountResult.error.message}`)
  }
  const accounts = accountResult.value
  return new PublicKey(accounts[Math.floor(Math.random() * accounts.length)])
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<SubmitCancelBundleResponse>
) {
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'Method not allowed' })
  }

  try {
    const { signedTransactions, orderIds }: SubmitCancelBundleRequest = req.body

    console.log('🔗 JITO BUNDLE SUBMISSION - Order Cancellation')
    console.log(`🔄 Cancelling ${orderIds.length} orders:`, orderIds)
    console.log(`📄 Processing ${signedTransactions.length} cancel transactions`)

    // Try to load the .env file
    const jitoEnvPath = path.join(process.cwd(), '.env')
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

    const blockEngineUrl = jitoEnv.BLOCK_ENGINE_URL || process.env.BLOCK_ENGINE_URL
    const authKeypairPath = jitoEnv.AUTH_KEYPAIR_PATH || process.env.AUTH_KEYPAIR_PATH
    const rpcUrl = jitoEnv.RPC_URL || process.env.RPC_URL
    const bundleTransactionLimit = parseInt(jitoEnv.BUNDLE_TRANSACTION_LIMIT || process.env.BUNDLE_TRANSACTION_LIMIT || "5")

    if (!blockEngineUrl || !authKeypairPath || !rpcUrl) {
      console.error('Missing environment variables')
      return res.status(500).json({
        success: false,
        error: 'Server configuration missing. Please check BLOCK_ENGINE_URL, AUTH_KEYPAIR_PATH and RPC_URL in .env'
      })
    }

    // Load the authority keypair from array (for tip transaction)
    let serverKeypair: Keypair
    try {
      const keypairData = JSON.parse(authKeypairPath) as number[]
      serverKeypair = Keypair.fromSecretKey(new Uint8Array(keypairData))
      console.log('✅ Server keypair loaded successfully:', serverKeypair.publicKey.toString())
    } catch (error) {
      console.error('❌ Error parsing auth keypair array:', error)
      return res.status(500).json({ 
        success: false, 
        error: 'Invalid AUTH_KEYPAIR_PATH format. Must be a valid JSON array of numbers.' 
      })
    }

    // Create the searcher client that will interact with Jito
    const searcherClientInstance = searcherClient(blockEngineUrl)
    
    // Subscribe to the bundle result (simple logging like working examples)
    searcherClientInstance.onBundleResult(
      (result) => {
        console.log("📦 Received cancel bundle result:", result)
      },
      (e) => {
        console.error("❌ Cancel bundle result error:", e)
      },
    )

    // Get a random tip account address from Jito
    const tipAccount = await getRandomTipAccountAddress(searcherClientInstance)
    console.log("💰 Jito tip account:", tipAccount.toString())

    // Deserialize all user signed transactions
    const userTransactions: VersionedTransaction[] = []
    signedTransactions.forEach((signedTxBase64, index) => {
      const userTxBuffer = Buffer.from(signedTxBase64, "base64")
      const userSignedTx = VersionedTransaction.deserialize(new Uint8Array(userTxBuffer))
      userTransactions.push(userSignedTx)
      console.log(`👤 Cancel transaction ${index + 1} signature:`, bs58.encode(userSignedTx.signatures[0]))
    })

    // Connect to RPC
    const connection = new Connection(rpcUrl, "confirmed")
    const blockHash = await connection.getLatestBlockhash()

    // Create tip transaction (signed by server) - MUST be last in bundle
    const tipAmount = 1000 // 1000 lamports tip
    
    const tipIx = SystemProgram.transfer({
      fromPubkey: serverKeypair.publicKey,
      toPubkey: tipAccount,
      lamports: tipAmount,
    })

    const tipTx = new VersionedTransaction(
      new TransactionMessage({
        payerKey: serverKeypair.publicKey,
        recentBlockhash: blockHash.blockhash,
        instructions: [tipIx],
      }).compileToV0Message()
    )
    tipTx.sign([serverKeypair])

    console.log('💰 Tip transaction signature:', bs58.encode(tipTx.signatures[0]))

    // Create the Jito bundle using the proper SDK (cancel txs first, tip tx last)
    console.log('📦 Creating Jito bundle with cancel transactions...')
    const bundleTransactions = [...userTransactions, tipTx] // Cancel transactions first, tip transaction last
    const jitoBundle = new Bundle(
      bundleTransactions,
      bundleTransactionLimit,
    )
    console.log(`✅ Jito bundle created successfully with ${bundleTransactions.length} transactions`)

    try {
      // Send the bundle using Jito searcher client
      console.log('📤 Sending cancel bundle to Jito...')
      const resp = await searcherClientInstance.sendBundle(jitoBundle)
      
      if (!resp.ok) {
        console.error("❌ Error sending cancel bundle:", resp.error.message)
        return res.status(500).json({
          success: false,
          error: `Cancel bundle submission failed: ${resp.error.message}`
        })
      } else {
        const bundleUUID = resp.value
        const userSignatures = userTransactions.map(tx => bs58.encode(tx.signatures[0]))
        
        console.log('🎉 JITO CANCEL BUNDLE SENT SUCCESSFULLY!')
        console.log('📦 Bundle UUID:', bundleUUID)
        console.log('🔄 Cancelled Orders:', orderIds)
        console.log('👤 Cancel Transaction Signatures:', userSignatures)
        console.log('💰 Tip Transaction:', bs58.encode(tipTx.signatures[0]))

        // Return immediately like working examples (don't wait for bundle result)
        res.status(200).json({
          success: true,
          bundleId: bundleUUID, // Real Jito bundle UUID
          signatures: userSignatures
        })
      }

    } catch (sendError: any) {
      console.error("❌ Error sending cancel bundle:", sendError)
      res.status(500).json({
        success: false,
        error: `Cancel bundle submission failed: ${sendError.message}`
      })
    }

  } catch (error: any) {
    console.error("❌ Error in submit-cancel-bundle:", error)
    res.status(500).json({
      success: false,
      error: error.message || 'Internal server error'
    })
  }
} 