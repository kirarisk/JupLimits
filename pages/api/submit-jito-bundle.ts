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
import { searcherClient, SearcherClient } from 'jito-ts/dist/sdk/block-engine/searcher'
import { Bundle } from 'jito-ts/dist/sdk/block-engine/types'

interface SubmitBundleRequest {
  signedTransaction: string
  orderId: string
  makingAmount?: number
  inputMint?: string
}

interface SubmitBundleResponse {
  success: boolean
  bundleId?: string
  signature?: string
  error?: string
}

const getRandomTipAccountAddress = async (searcherClient: SearcherClient) => {
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
      return res.status(500).json({
        success: false,
        error: 'Server configuration missing'
      })
    }

    let serverKeypair: Keypair
    try {
      const keypairData = JSON.parse(authKeypairPath) as number[]
      serverKeypair = Keypair.fromSecretKey(new Uint8Array(keypairData))
    } catch (error) {
      return res.status(500).json({ 
        success: false, 
        error: 'Invalid AUTH_KEYPAIR_PATH format' 
      })
    }

    const searcherClientInstance = searcherClient(blockEngineUrl)
    
    searcherClientInstance.onBundleResult(
      (result) => {},
      (e) => {},
    )

    const tipAccount = await getRandomTipAccountAddress(searcherClientInstance)

    const userTxBuffer = Buffer.from(signedTransaction, "base64")
    const userSignedTx = VersionedTransaction.deserialize(new Uint8Array(userTxBuffer))

    const connection = new Connection(rpcUrl, "confirmed")
    const blockHash = await connection.getLatestBlockhash()

    const currentInputMint = inputMint || 'So11111111111111111111111111111111111111112'
    const makingAmountUnits = makingAmount || 50000000
    const feeAmountUnits = Math.floor(makingAmountUnits * 0.01)
    const feeWallet = new PublicKey("FeegNqsGa7ppvuLRLj5xvqEu11cC1tXpWmwqdoqsMXnN")

    let feeTx: VersionedTransaction

    if (currentInputMint === 'So11111111111111111111111111111111111111112') {
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
      try {
        const { createTransferInstruction, getAssociatedTokenAddress } = await import('@solana/spl-token')
        
        const serverTokenAccount = await getAssociatedTokenAddress(
          new PublicKey(currentInputMint),
          serverKeypair.publicKey
        )
        
        const feeWalletTokenAccount = await getAssociatedTokenAddress(
          new PublicKey(currentInputMint),
          feeWallet
        )
        
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
        const feeIx = SystemProgram.transfer({
          fromPubkey: serverKeypair.publicKey,
          toPubkey: feeWallet,
          lamports: Math.floor(feeAmountUnits / 1000),
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

    const tipAmount = 1000
    
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

    const jitoBundle = new Bundle(
      [userSignedTx, feeTx, tipTx],
      bundleTransactionLimit,
    )

    const resp = await searcherClientInstance.sendBundle(jitoBundle)
    
    if (!resp.ok) {
      return res.status(500).json({
        success: false,
        error: `Bundle submission failed: ${resp.error.message}`
      })
    }

    const bundleUUID = resp.value

    res.status(200).json({
      success: true,
      bundleId: bundleUUID,
      signature: bs58.encode(userSignedTx.signatures[0])
    })

  } catch (error: any) {
    console.error("❌ Error in submit-jito-bundle:", error)
    res.status(500).json({
      success: false,
      error: error.message || 'Internal server error'
    })
  }
} 