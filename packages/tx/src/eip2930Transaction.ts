import { Address, BN, bnToHex, ecsign, rlp, rlphash, toBuffer } from 'ethereumjs-util'
import { BaseTransaction } from './baseTransaction'
import { EIP2930TxData, TxOptions, JsonEIP2930Tx } from './types'

export default class EIP2930Transaction extends BaseTransaction<
  EIP2930Transaction,
  JsonEIP2930Tx
> {
  public readonly chainId: BN
  public readonly nonce: BN
  public readonly gasLimit: BN
  public readonly gasPrice: BN
  public readonly to?: Address
  public readonly value: BN
  public readonly data: Buffer
  public readonly accessList: any
  public readonly yParity?: number
  public readonly r?: BN
  public readonly s?: BN

  get senderS() {
    return this.s
  }

  get senderR() {
    return this.r
  }

  public static fromTxData(txData: EIP2930TxData, opts?: TxOptions) {
    return new EIP2930Transaction(txData, opts ?? {})
  }

  // Instantiate a transaction from the raw RLP serialized tx. This means that the RLP should start with 0x01.
  public static fromRlpSerializedTx(serialized: Buffer, opts?: TxOptions) {
    if (serialized[0] !== 1) {
      throw 'This is not an EIP-2930 transaction'
    }

    const values = rlp.decode(serialized.slice(1))

    if (!Array.isArray(values)) {
      throw new Error('Invalid serialized tx input. Must be array')
    }

    return EIP2930Transaction.fromValuesArray(values, opts)
  }

  // Create a transaction from a values array.
  // The format is: chainId, nonce, gasPrice, gasLimit, to, value, data, access_list, [yParity, senderR, senderS]
  public static fromValuesArray(values: Buffer[], opts?: TxOptions) {
    if (values.length == 8) {
      const [chainId, nonce, gasPrice, gasLimit, to, value, data, accessList] = values
      const emptyBuffer = Buffer.from([])

      return new EIP2930Transaction(
        {
          chainId: new BN(chainId),
          nonce: new BN(nonce),
          gasPrice: new BN(gasPrice),
          gasLimit: new BN(gasLimit),
          to: to && to.length > 0 ? new Address(to) : undefined,
          value: new BN(value),
          data: data ?? emptyBuffer,
          accessList: accessList ?? emptyBuffer,
        },
        opts ?? {}
      )
    } else if (values.length == 11) {
      // TODO: return EIP2930SignedTransaction
      const [
        chainId,
        nonce,
        gasPrice,
        gasLimit,
        to,
        value,
        data,
        accessList,
        yParity,
        r,
        s,
      ] = values
      const emptyBuffer = Buffer.from([])

      return new EIP2930Transaction(
        {
          chainId: new BN(chainId),
          nonce: new BN(nonce),
          gasPrice: new BN(gasPrice),
          gasLimit: new BN(gasLimit),
          to: to && to.length > 0 ? new Address(to) : undefined,
          value: new BN(value),
          data: data ?? emptyBuffer,
          accessList: accessList ?? emptyBuffer,
          yParity: !yParity?.equals(emptyBuffer)
            ? parseInt(yParity.toString('hex'), 16)
            : undefined,
          r: !r?.equals(emptyBuffer) ? new BN(r) : undefined,
          s: !s?.equals(emptyBuffer) ? new BN(s) : undefined,
        },
        opts ?? {}
      )
    } else {
      throw new Error(
        'Invalid EIP-2930 transaction. Only expecting 8 values (for unsigned tx) or 11 values (for signed tx).'
      )
    }
  }

  protected constructor(txData: EIP2930TxData, opts: TxOptions) {
    const {
      chainId,
      nonce,
      gasPrice,
      gasLimit,
      to,
      value,
      data,
      accessList,
      yParity,
      r,
      s,
    } = txData

    super({ to }, opts)

    if (!this.common.eips().includes(2718)) {
      throw new Error('EIP-2718 not enabled on Common')
    } else if (!this.common.eips().includes(2930)) {
      throw new Error('EIP-2930 not enabled on Common')
    }

    if (txData.chainId?.eqn(this.common.chainId())) {
      throw new Error('The chain ID does not match the chain ID of Common')
    }

    this.chainId = new BN(toBuffer(chainId))
    this.nonce = new BN(toBuffer(nonce))
    this.gasPrice = new BN(toBuffer(gasPrice))
    this.gasLimit = new BN(toBuffer(gasLimit))
    this.to = to ? new Address(toBuffer(to)) : undefined
    this.value = new BN(toBuffer(value))
    this.data = toBuffer(data)
    this.accessList = accessList ?? []
    this.yParity = yParity ?? 0
    this.r = r ? new BN(toBuffer(r)) : undefined
    this.s = s ? new BN(toBuffer(s)) : undefined

    // Verify the access list format.
    for (let key = 0; key < this.accessList.length; key++) {
      const accessListItem = this.accessList[key]
      const address: Buffer = accessListItem[0]
      const storageSlots: Buffer[] = accessListItem[1]
      if (accessListItem[2] !== undefined) {
        throw new Error(
          'Access list item cannot have 3 elements. It can only have an address, and an array of storage slots.'
        )
      }
      if (address.length != 20) {
        throw new Error('Invalid EIP-2930 transaction: address length should be 20 bytes')
      }
      for (let storageSlot = 0; storageSlot < storageSlots.length; storageSlot++) {
        if (storageSlots[storageSlot].length != 32) {
          throw new Error('Invalid EIP-2930 transaction: storage slot length should be 32 bytes')
        }
      }
    }

    const freeze = opts?.freeze ?? true
    if (freeze) {
      Object.freeze(this)
    }
  }

  getMessageToSign() {
    return rlphash(this.raw())
  }

  sign(privateKey: Buffer) {
    if (privateKey.length !== 32) {
      throw new Error('Private key must be 32 bytes in length.')
    }

    const msgHash = this.getMessageToSign()

    // Only `v` is reassigned.
    /* eslint-disable-next-line prefer-const */
    let { v, r, s } = ecsign(msgHash, privateKey)

    const opts = {
      common: this.common,
    }

    return EIP2930Transaction.fromTxData(
      {
        chainId: this.chainId,
        nonce: this.nonce,
        gasPrice: this.gasPrice,
        gasLimit: this.gasLimit,
        to: this.to,
        value: this.value,
        data: this.data,
        accessList: this.accessList,
        yParity: v, // TODO: check if this is correct. Should be a number between 0/1
        r: new BN(r),
        s: new BN(s),
      },
      opts
    )
  }

  /**
   * The amount of gas paid for the data in this tx
   */
  getDataFee(): BN {
    const txDataZero = this.common.param('gasPrices', 'txDataZero')
    const txDataNonZero = this.common.param('gasPrices', 'txDataNonZero')
    const accessListStorageKeyCost = this.common.param('gasPrices', 'accessListStorageKeyCost')
    const accessListAddressCost = this.common.param('gasPrices', 'accessListAddressCost')

    let cost = 0
    for (let i = 0; i < this.data.length; i++) {
      this.data[i] === 0 ? (cost += txDataZero) : (cost += txDataNonZero)
    }

    let slots = 0
    for (let index = 0; index < this.accessList.length; index++) {
      const item = this.accessList[index]
      const storageSlots = item[1]
      slots += storageSlots.length
    }

    const addresses = this.accessList.length
    cost += addresses * accessListAddressCost + slots * accessListStorageKeyCost

    return new BN(cost)
  }

  /**
   * The minimum amount of gas the tx must have (DataFee + TxFee + Creation Fee)
   */
  getBaseFee(): BN {
    const fee = this.getDataFee().addn(this.common.param('gasPrices', 'tx'))
    if (this.common.gteHardfork('homestead') && this.toCreationAddress()) {
      fee.iaddn(this.common.param('gasPrices', 'txCreation'))
    }
    return fee
  }

  /**
   * The up front amount that an account must have for this transaction to be valid
   */
  getUpfrontCost(): BN {
    return this.gasLimit.mul(this.gasPrice).add(this.value)
  }

  /**
   * Validates the signature and checks if
   * the transaction has the minimum amount of gas required
   * (DataFee + TxFee + Creation Fee).
   */
  validate(): boolean
  validate(stringError: false): boolean
  validate(stringError: true): string[]
  validate(stringError: boolean = false): boolean | string[] {
    const errors = []

    if (this.getBaseFee().gt(this.gasLimit)) {
      errors.push(`gasLimit is too low. given ${this.gasLimit}, need at least ${this.getBaseFee()}`)
    }

    return stringError ? errors : errors.length === 0
  }

  /**
   * Returns a Buffer Array of the raw Buffers of this transaction, in order.
   */
  raw(): Buffer[] {
    return [
      this.chainId.toBuffer(),
      this.nonce.toBuffer(),
      this.gasPrice.toBuffer(),
      this.gasLimit.toBuffer(),
      this.to !== undefined ? this.to.buf : Buffer.from([]),
      this.value.toBuffer(),
      this.data,
      this.accessList,
    ]
  }

  /**
   * Returns the rlp encoding of the transaction.
   */
  serialize(): Buffer {
    const RLPEncodedTx = rlp.encode(this.raw())

    return Buffer.concat([Buffer.from('01', 'hex'), RLPEncodedTx])
  }

  /**
   * Returns an object with the JSON representation of the transaction
   */
  toJSON(): JsonEIP2930Tx {
    // TODO: fix type
    const accessListJSON = []
    for (let index = 0; index < this.accessList.length; index++) {
      const item = this.accessList[index]
      const JSONItem: any = ['0x' + item[0].toString('hex')]
      const storageSlots = item[1]
      const JSONSlots = []
      for (let slot = 0; slot < storageSlots.length; slot++) {
        const storageSlot = storageSlots[slot]
        JSONSlots.push('0x' + storageSlot.toString('hex'))
      }
      JSONItem.push(JSONSlots)
      accessListJSON.push(JSONItem)
    }

    return {
      chainId: bnToHex(this.chainId),
      nonce: bnToHex(this.nonce),
      gasPrice: bnToHex(this.gasPrice),
      gasLimit: bnToHex(this.gasLimit),
      to: this.to !== undefined ? this.to.toString() : undefined,
      value: bnToHex(this.value),
      data: '0x' + this.data.toString('hex'),
      accessList: accessListJSON,
    }
  }

  public isSigned(): boolean {
    return false
  }
}