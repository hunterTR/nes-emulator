var Memory = (function () {
    function Memory() {
        this.memory = new Int8Array(65535);
    }
    Memory.prototype.getByte = function (addr) {
        return this.memory[addr];
    };
    Memory.prototype.getWord = function (addr) {
        return 256 * this.memory[addr] + this.memory[addr + 1];
    };
    Memory.prototype.setByte = function (addr, value) {
        this.memory[addr] = value % 256;
    };
    Memory.prototype.setWord = function (addr, value) {
        this.memory[addr] = (value / 256) % 256;
        this.memory[addr + 1] = value % 256;
    };
    return Memory;
})();
var Mos6502 = (function () {
    function Mos6502() {
        this.rI = 0;
        this.rA = 0;
        this.rX = 0;
        this.rY = 0;
        this.ip = 0;
        this.flgCarry = 0;
        this.flgZero = 0;
        this.flgInterruptDisable = 0;
        this.flgDecimalMode = 0;
        this.flgBreakCommand = 0;
        this.flgOverflow = 0;
        this.flgNegative = 0;
    }
    /*
        ADC - Add with Carry

        A,Z,C,N = A+M+C
        This instruction adds the contents of a memory location to the accumulator together with the carry bit.
        If overflow occurs the carry bit is set, this enables multiple byte addition to be performed.

        Processor Status after use:

        C	Carry Flag	        Set if overflow in bit 7
        Z	Zero Flag	        Set if A = 0
        I	Interrupt Disable	Not affected
        D	Decimal Mode Flag	Not affected
        B	Break Command	    Not affected
        V	Overflow Flag	    Set if sign bit is incorrect
        N	Negative Flag	    Set if bit 7 set
    */
    Mos6502.prototype.ADC = function (b) {
        var sum = this.rA + b + this.flgCarry;
        var bothPositive = b < 128 && this.rA < 128;
        var bothNegative = b >= 128 && this.rA >= 128;
        this.flgCarry = sum > 255 ? 1 : 0;
        this.rA = sum % 256;
        this.flgNegative = this.rA >= 128 ? 1 : 0;
        this.flgZero = this.rA === 0 ? 1 : 0;
        this.flgOverflow = bothPositive && this.flgNegative || bothNegative && !this.flgNegative ? 1 : 0;
    };
    /**
     * SBC - Subtract with Carry

        A,Z,C,N = A-M-(1-C)

        This instruction subtracts the contents of a memory location to the accumulator together with the not of the carry bit. If overflow occurs the carry bit is clear, this enables multiple byte subtraction to be performed.

        Processor Status after use:

        C	Carry Flag	        Clear if overflow in bit 7
        Z	Zero Flag	        Set if A = 0
        I	Interrupt Disable	Not affected
        D	Decimal Mode Flag	Not affected
        B	Break Command	    Not affected
        V	Overflow Flag	    Set if sign bit is incorrect
        N	Negative Flag	    Set if bit 7 set
     */
    Mos6502.prototype.SBC = function (b) {
        this.ADC(255 - b);
    };
    /**
     * AND - Logical AND
       A,Z,N = A&M
    
       A logical AND is performed, bit by bit, on the accumulator contents using the contents of a byte of memory.
       Processor Status after use:

        C	Carry Flag	Not affected
        Z	Zero Flag	Set if A = 0
        I	Interrupt Disable	Not affected
        D	Decimal Mode Flag	Not affected
        B	Break Command	Not affected
        V	Overflow Flag	Not affected
        N	Negative Flag	Set if bit 7 set
     */
    Mos6502.prototype.AND = function (byte) {
        this.rA &= byte;
        this.flgZero = this.rA === 0 ? 1 : 0;
        this.flgNegative = this.rA >= 128 ? 1 : 0;
    };
    /**
        ASL - Arithmetic Shift Left
        A,Z,C,N = M*2 or M,Z,C,N = M*2

        This operation shifts all the bits of the accumulator or memory contents one bit left.
        Bit 0 is set to 0 and bit 7 is placed in the carry flag. The effect of this operation is
        to multiply the memory contents by 2 (ignoring 2's complement considerations),
        setting the carry if the result will not fit in 8 bits.

        Processor Status after use:

        C	Carry Flag	Set to contents of old bit 7
        Z	Zero Flag	Set if A = 0
        I	Interrupt Disable	Not affected
        D	Decimal Mode Flag	Not affected
        B	Break Command	Not affected
        V	Overflow Flag	Not affected
        N	Negative Flag	Set if bit 7 of the result is set
    */
    Mos6502.prototype.ASL = function (byte) {
        this.rA = byte << 1;
        this.flgCarry = this.rA > 255 ? 1 : 0;
        this.flgNegative = this.rA >= 128 ? 1 : 0;
        this.rA %= 256;
        this.flgZero = this.rA === 0 ? 1 : 0;
    };
    Mos6502.prototype.getByteImmediate = function () { return this.memory.getByte(this.ip + 1); };
    Mos6502.prototype.getWordImmediate = function () { return this.memory.getWord(this.ip + 1); };
    Mos6502.prototype.getByteZeroPage = function () { return this.memory.getByte(this.getByteImmediate()); };
    Mos6502.prototype.getWordZeroPage = function () { return this.memory.getWord(this.getByteImmediate()); };
    Mos6502.prototype.getByteZeroPageX = function () { return this.memory.getByte((this.rX + this.getByteImmediate()) % 256); };
    Mos6502.prototype.getWordZeroPageX = function () { return this.memory.getWord((this.rX + this.getByteImmediate()) % 256); };
    Mos6502.prototype.getByteZeroPageY = function () { return this.memory.getByte((this.rY + this.getByteImmediate()) % 256); };
    Mos6502.prototype.getWordZeroPageY = function () { return this.memory.getWord((this.rY + this.getByteImmediate()) % 256); };
    Mos6502.prototype.getByteAbsolute = function () { return this.memory.getByte(this.getWordImmediate()); };
    Mos6502.prototype.getWordAbsolute = function () { return this.memory.getWord(this.getWordImmediate()); };
    Mos6502.prototype.getByteAbsoluteX = function () { return this.memory.getByte((this.rX + this.getWordImmediate()) % 65536); };
    Mos6502.prototype.getWordAbsoluteX = function () { return this.memory.getWord((this.rX + this.getWordImmediate()) % 65536); };
    Mos6502.prototype.getByteAbsoluteY = function () { return this.memory.getByte((this.rY + this.getWordImmediate()) % 65536); };
    Mos6502.prototype.getWordAbsoluteY = function () { return this.memory.getWord((this.rY + this.getWordImmediate()) % 65536); };
    Mos6502.prototype.getByteIndirect = function () { return this.memory.getByte(this.memory.getWord(this.getWordImmediate())); };
    Mos6502.prototype.getWordIndirect = function () { return this.memory.getWord(this.memory.getWord(this.getWordImmediate())); };
    Mos6502.prototype.getByteIndirectX = function () { return this.memory.getByte(this.memory.getWord((this.getByteImmediate() + this.rX) % 256)); };
    Mos6502.prototype.getWordIndirectX = function () { return this.memory.getWord(this.memory.getWord((this.getByteImmediate() + this.rX) % 256)); };
    Mos6502.prototype.getByteIndirectY = function () { return this.memory.getByte((this.memory.getWord(this.getByteImmediate()) + this.rY) % 65536); };
    Mos6502.prototype.getWordIndirectY = function () { return this.memory.getWord((this.memory.getWord(this.getByteImmediate()) + this.rY) % 65536); };
    Mos6502.prototype.step = function () {
        switch (this.memory.getByte(this.ip)) {
            case 0x69:
                this.ADC(this.getByteImmediate());
                this.ip += 2;
                break;
            case 0x65:
                this.ADC(this.getByteZeroPage());
                this.ip += 2;
                break;
            case 0x75:
                this.ADC(this.getByteZeroPageX());
                this.ip += 2;
                break;
            case 0x6d:
                this.ADC(this.getByteAbsolute());
                this.ip += 3;
                break;
            case 0x7d:
                this.ADC(this.getByteAbsoluteX());
                this.ip += 3;
                break;
            case 0x79:
                this.ADC(this.getByteAbsoluteY());
                this.ip += 3;
                break;
            case 0x61:
                this.ADC(this.getByteIndirectX());
                this.ip += 2;
                break;
            case 0x71:
                this.ADC(this.getByteIndirectY());
                this.ip += 2;
                break;
            case 0xe9:
                this.SBC(this.getByteImmediate());
                this.ip += 2;
                break;
            case 0xe5:
                this.SBC(this.getByteZeroPage());
                this.ip += 2;
                break;
            case 0xf5:
                this.SBC(this.getByteZeroPageX());
                this.ip += 2;
                break;
            case 0xed:
                this.SBC(this.getByteAbsolute());
                this.ip += 3;
                break;
            case 0xfd:
                this.SBC(this.getByteAbsoluteX());
                this.ip += 3;
                break;
            case 0xf9:
                this.SBC(this.getByteAbsoluteY());
                this.ip += 3;
                break;
            case 0xe1:
                this.SBC(this.getByteIndirectX());
                this.ip += 2;
                break;
            case 0xf1:
                this.SBC(this.getByteIndirectY());
                this.ip += 2;
                break;
            case 0x29:
                this.AND(this.getByteImmediate());
                this.ip += 2;
                break;
            case 0x25:
                this.AND(this.getByteZeroPage());
                this.ip += 2;
                break;
            case 0x35:
                this.AND(this.getByteZeroPageX());
                this.ip += 2;
                break;
            case 0x2D:
                this.AND(this.getByteAbsolute());
                this.ip += 3;
                break;
            case 0x3D:
                this.AND(this.getByteAbsoluteX());
                this.ip += 3;
                break;
            case 0x39:
                this.AND(this.getByteAbsoluteY());
                this.ip += 3;
                break;
            case 0x21:
                this.AND(this.getByteIndirectX());
                this.ip += 2;
                break;
            case 0x31:
                this.AND(this.getByteIndirectY());
                this.ip += 2;
                break;
            case 0x0a:
                this.ASL(this.rA);
                this.ip += 1;
                break;
            case 0x06:
                this.ASL(this.getByteZeroPage());
                this.ip += 2;
                break;
            case 0x0e:
                this.ASL(this.getByteAbsolute());
                this.ip += 3;
                break;
            case 0x1e:
                this.ASL(this.getByteAbsoluteX());
                this.ip += 3;
                break;
        }
    };
    return Mos6502;
})();
//# sourceMappingURL=app.js.map