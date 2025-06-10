import type { NextApiRequest, NextApiResponse } from 'next'

interface OpenOrdersResponse {
  success: boolean
  orders?: any[]
  error?: string
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<OpenOrdersResponse>
) {
  if (req.method !== 'GET') {
    return res.status(405).json({ success: false, error: 'Method not allowed' })
  }

  try {
    const { wallet } = req.query

    if (!wallet || typeof wallet !== 'string') {
      return res.status(400).json({ 
        success: false, 
        error: 'Wallet address is required' 
      })
    }

    const openOrdersResponse = await fetch(`https://api.jup.ag/limit/v2/openOrders?wallet=${wallet}`)
    
    if (!openOrdersResponse.ok) {
      const errorText = await openOrdersResponse.text()
      return res.status(500).json({ 
        success: false, 
        error: `Jupiter API error: ${openOrdersResponse.status} ${errorText}` 
      })
    }
    
    const orders = await openOrdersResponse.json()
    
    res.status(200).json({
      success: true,
      orders
    })

  } catch (error: any) {
    res.status(500).json({
      success: false,
      error: error.message || 'Internal server error'
    })
  }
} 