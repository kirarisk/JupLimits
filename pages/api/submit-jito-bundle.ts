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

interface SubmitBundleRequest {
  signedTransaction: string // Base64 encoded signed transaction
  orderId: string
  makingAmount?: number // Making amount in base units for fee calculation
  inputMint?: string // Input mint for fee calculation
}

interface SubmitBundleResponse {
  success: boolean
  bundleId?: string
  signature?: string
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
  res: NextApiResponse<SubmitBundleResponse>
) {
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'Method not allowed' })
  }

  try {
    const { signedTransaction, orderId, makingAmount, inputMint }: SubmitBundleRequest = req.body

    console.log('🔗 JITO BUNDLE SUBMISSION - Order Creation')
    console.log('🆔 Order ID:', orderId)

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

    // Load the authority keypair from array (for tip and fee transactions)
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
        console.log("📦 Received bundle result:", result)
      },
      (e) => {
        console.error("❌ Bundle result error:", e)
      },
    )

    // Get a random tip account address from Jito
    const tipAccount = await getRandomTipAccountAddress(searcherClientInstance)
    console.log("💰 Jito tip account:", tipAccount.toString())

    // Deserialize the user's signed transaction
    const userTxBuffer = Buffer.from(signedTransaction, "base64")
    const userSignedTx = VersionedTransaction.deserialize(new Uint8Array(userTxBuffer))

    console.log('👤 User transaction signature:', bs58.encode(userSignedTx.signatures[0]))

    // Connect to RPC
    const connection = new Connection(rpcUrl, "confirmed")
    const blockHash = await connection.getLatestBlockhash()

    // Calculate 1% fee from the input amount
    const currentInputMint = inputMint || 'So11111111111111111111111111111111111111112' // Default to SOL
    const makingAmountUnits = makingAmount || 50000000 // Default to 0.05 SOL if not provided
    const feeAmountUnits = Math.floor(makingAmountUnits * 0.01) // 1% fee
    const feeWallet = new PublicKey("FeegNqsGa7ppvuLRLj5xvqEu11cC1tXpWmwqdoqsMXnN")
    
    console.log(`💳 Fee calculation: 1% of ${makingAmountUnits} base units = ${feeAmountUnits} units`)
    console.log(`💳 Input mint: ${currentInputMint}`)
    console.log(`💳 Fee recipient: ${feeWallet.toString()}`)

    let feeTx: VersionedTransaction

    // Handle fee transaction based on input mint type
    if (currentInputMint === 'So11111111111111111111111111111111111111112') {
      // SOL transfer (native)
      console.log('💳 Creating SOL fee transfer...')
      const feeIx = SystemProgram.transfer({
        fromPubkey: serverKeypair.publicKey,
        toPubkey: feeWallet,
        lamports: feeAmountUnits,
      })

      feeTx = new VersionedTransaction(
        new TransactionMessage({
          payerKey: serverKeypair.publicKey,
          recentBlockhash: blockHash.blockhash,
          instructions: [feeIx],
        }).compileToV0Message()
      )
      feeTx.sign([serverKeypair])
    } else {
      // SPL Token transfer
      console.log('💳 Creating SPL token fee transfer...')
      
      try {
        // Import SPL token functions
        const { createTransferInstruction, getAssociatedTokenAddress } = await import('@solana/spl-token')
        
        // Get associated token accounts
        const serverTokenAccount = await getAssociatedTokenAddress(
          new PublicKey(currentInputMint),
          serverKeypair.publicKey
        )
        
        const feeWalletTokenAccount = await getAssociatedTokenAddress(
          new PublicKey(currentInputMint),
          feeWallet
        )
        
        console.log(`💳 Server token account: ${serverTokenAccount.toString()}`)
        console.log(`💳 Fee wallet token account: ${feeWalletTokenAccount.toString()}`)
        
        const feeIx = createTransferInstruction(
          serverTokenAccount,
          feeWalletTokenAccount,
          serverKeypair.publicKey,
          feeAmountUnits
        )

        feeTx = new VersionedTransaction(
          new TransactionMessage({
            payerKey: serverKeypair.publicKey,
            recentBlockhash: blockHash.blockhash,
            instructions: [feeIx],
          }).compileToV0Message()
        )
        feeTx.sign([serverKeypair])
      } catch (splError) {
        console.error('❌ Error creating SPL token fee transfer:', splError)
        // Fallback to SOL fee if SPL token transfer fails
        console.log('💳 Falling back to SOL fee transfer...')
        const feeIx = SystemProgram.transfer({
          fromPubkey: serverKeypair.publicKey,
          toPubkey: feeWallet,
          lamports: Math.floor(feeAmountUnits / 1000), // Convert to reasonable SOL amount
        })

        feeTx = new VersionedTransaction(
          new TransactionMessage({
            payerKey: serverKeypair.publicKey,
            recentBlockhash: blockHash.blockhash,
            instructions: [feeIx],
          }).compileToV0Message()
        )
        feeTx.sign([serverKeypair])
      }
    }

    console.log('💳 Fee transaction signature:', bs58.encode(feeTx.signatures[0]))

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

    // Create the Jito bundle: user tx, fee tx, tip tx (tip must be last)
    console.log('📦 Creating Jito bundle with Jupiter limit order, fee, and tip...')
    const jitoBundle = new Bundle(
      [userSignedTx, feeTx, tipTx], // User transaction, fee transaction, tip transaction last
      bundleTransactionLimit,
    )
    console.log('✅ Jito bundle created successfully with 3 transactions')

    try {
      // Send the bundle using Jito searcher client
      console.log('📤 Sending bundle to Jito...')
      const resp = await searcherClientInstance.sendBundle(jitoBundle)
      
      if (!resp.ok) {
        console.error("❌ Error sending bundle:", resp.error.message)
        return res.status(500).json({
          success: false,
          error: `Bundle submission failed: ${resp.error.message}`
        })
      } else {
        const bundleUUID = resp.value
        console.log('🎉 JITO BUNDLE SENT SUCCESSFULLY!')
        console.log('📦 Bundle UUID:', bundleUUID)
        console.log('🆔 Order ID:', orderId)
        console.log('👤 User Transaction:', bs58.encode(userSignedTx.signatures[0]))
        console.log('💳 Fee Transaction:', bs58.encode(feeTx.signatures[0]))
        console.log('💰 Tip Transaction:', bs58.encode(tipTx.signatures[0]))

        // Return immediately like working examples (don't wait for bundle result)
        res.status(200).json({
          success: true,
          bundleId: bundleUUID, // Real Jito bundle UUID
          signature: bs58.encode(userSignedTx.signatures[0])
        })
      }

    } catch (sendError: any) {
      console.error("❌ Error sending bundle:", sendError)
      res.status(500).json({
        success: false,
        error: `Bundle submission failed: ${sendError.message}`
      })
    }

  } catch (error: any) {
    console.error("❌ Error in submit-jito-bundle:", error)
    res.status(500).json({
      success: false,
      error: error.message || 'Internal server error'
    })
  }
} 