import {
  generatePseudoRandomSalt,
  orderHashUtils,
  SignatureType,
  signatureUtils,
  SignerType,
} from '0x-v2-order-utils'
import * as ethUtils from 'ethereumjs-util'
import { utils, Wallet } from 'ethers'
import { BigNumber, orderBNToString } from '../utils'
import { ecSignOrderHash } from './ecsign'

// changes of PMMV5
// - taker address point to PMM contract
// - fee factor from salt
// - user address from fee recipient

export const generateSaltWithFeeFactor = (feeFactor: number) => {
  const feeHex = utils.hexZeroPad('0x' + feeFactor.toString(16), 2)
  // append 001e = 30 (fee factor to salt)
  return new BigNumber(generatePseudoRandomSalt().toString(16).slice(0, -4) + feeHex.slice(2), 16)
}

// Signature:
// +------|---------|---------|---------|---------+
// |  V   |    R    |    S    |userAddr |feeFactor|
// +------|---------|---------|---------|---------+
export function signWithUserAndFee(
  signer: Wallet,
  orderHash: string,
  userAddr: string,
  feeFactor: number
) {
  const hash = ethUtils.bufferToHex(
    Buffer.concat([
      ethUtils.toBuffer(orderHash),
      ethUtils.toBuffer(userAddr.toLowerCase()),
      ethUtils.toBuffer(feeFactor > 255 ? feeFactor : [0, feeFactor]),
    ])
  )

  const signature = ecSignOrderHash(
    signer.privateKey.slice(2),
    hash,
    signer.address,
    SignerType.Default
  )

  const walletSign = ethUtils.bufferToHex(
    Buffer.concat([
      ethUtils.toBuffer(signature).slice(0, 65),
      ethUtils.toBuffer(userAddr.toLowerCase()),
      ethUtils.toBuffer(feeFactor > 255 ? feeFactor : [0, feeFactor]),
    ])
  )
  return walletSign
}

// Signature:
// +------|---------|---------|---------+
// |  v   |    R    |    S    | type(3) |
// +------|---------|---------|---------+
async function signByEOA(orderHash: string, wallet: Wallet): Promise<string> {
  const hashArray = utils.arrayify(orderHash)
  let signature = await wallet.signMessage(hashArray)
  signature = signature.slice(2)
  const v = signature.slice(signature.length - 2, signature.length)
  const rs = signature.slice(0, signature.length - 2)
  signature = '0x' + v + rs
  return signatureUtils.convertToSignatureWithType(signature, SignatureType.EthSign)
}

// For V4 Maket Maker Proxy (MMP)
// Signature:
// +------|---------|---------|---------|---------|---------+
// |  V   |    R    |    S    |userAddr |feeFactor| type(4) |
// +------|---------|---------|---------|---------|---------+
function signByMMPSigner(
  orderHash: string,
  userAddr: string,
  feeFactor: number,
  wallet: Wallet
): string {
  const walletSign = signWithUserAndFee(wallet, orderHash, userAddr, feeFactor)
  return signatureUtils.convertToSignatureWithType(walletSign, SignatureType.Wallet)
}

// Move fee factor to salt field
export const buildSignedOrder = async (signer: Wallet, order, userAddr, pmm) => {
  const feeFactor = order.feeFactor
  order.takerAddress = pmm.toLowerCase()
  order.senderAddress = pmm.toLowerCase()
  order.feeRecipientAddress = userAddr

  // inject fee factor to salt
  const o = {
    ...order,
    salt: generateSaltWithFeeFactor(feeFactor),
  }
  const orderHash = orderHashUtils.getOrderHashHex(o)
  const makerWalletSignature =
    signer.address.toLowerCase() == o.makerAddress.toLowerCase()
      ? await signByEOA(orderHash, signer)
      : signByMMPSigner(orderHash, userAddr, feeFactor, signer)

  const signedOrder = {
    ...o,
    makerWalletSignature,
  }

  return orderBNToString(signedOrder)
}
