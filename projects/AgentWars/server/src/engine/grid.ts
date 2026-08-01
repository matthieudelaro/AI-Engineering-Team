import { EMPTY } from "./constants.js";

export interface GridBounds {
  min_x: number;
  min_y: number;
  max_x: number;
  max_y: number;
}

export class Grid {
  readonly width: number;
  readonly height: number;
  readonly minX: number;
  readonly minY: number;
  readonly maxX: number;
  readonly maxY: number;

  private ownership: Uint8Array;
  private nuked: Uint8Array;

  private constructor(
    width: number,
    height: number,
    minX: number,
    minY: number,
    ownership?: Uint8Array,
    nuked?: Uint8Array,
  ) {
    this.width = width;
    this.height = height;
    this.minX = minX;
    this.minY = minY;
    this.maxX = minX + width - 1;
    this.maxY = minY + height - 1;
    const size = width * height;
    this.ownership = ownership ?? new Uint8Array(size);
    this.nuked = nuked ?? new Uint8Array(size);
  }

  static createInitial(size: number): Grid {
    const min = -Math.floor((size - 1) / 2);
    return new Grid(size, size, min, min);
  }

  static createCovering(
    minX: number,
    minY: number,
    maxX: number,
    maxY: number,
  ): Grid {
    const width = maxX - minX + 1;
    const height = maxY - minY + 1;
    return new Grid(width, height, minX, minY);
  }

  index(x: number, y: number): number {
    return (y - this.minY) * this.width + (x - this.minX);
  }

  inBounds(x: number, y: number): boolean {
    return x >= this.minX && x <= this.maxX && y >= this.minY && y <= this.maxY;
  }

  getOwner(x: number, y: number): number {
    return this.ownership[this.index(x, y)] ?? EMPTY;
  }

  setOwner(x: number, y: number, owner: number): void {
    this.ownership[this.index(x, y)] = owner;
  }

  isNuked(x: number, y: number): boolean {
    return (this.nuked[this.index(x, y)] ?? 0) === 1;
  }

  setNuked(x: number, y: number, value: boolean): void {
    this.nuked[this.index(x, y)] = value ? 1 : 0;
  }

  claimedCount(): number {
    let count = 0;
    for (const owner of this.ownership) {
      if (owner !== EMPTY) {
        count += 1;
      }
    }
    return count;
  }

  playerTileCount(playerId: number): number {
    let count = 0;
    for (const owner of this.ownership) {
      if (owner === playerId) {
        count += 1;
      }
    }
    return count;
  }

  resizeTo(newSize: number): void {
    const centerX = (this.minX + this.maxX) / 2;
    const centerY = (this.minY + this.maxY) / 2;
    const newMinX = Math.round(centerX - (newSize - 1) / 2);
    const newMinY = Math.round(centerY - (newSize - 1) / 2);
    const newOwnership = new Uint8Array(newSize * newSize);
    const newNuked = new Uint8Array(newSize * newSize);

    for (let y = this.minY; y <= this.maxY; y++) {
      for (let x = this.minX; x <= this.maxX; x++) {
        const newIdx = (y - newMinY) * newSize + (x - newMinX);
        newOwnership[newIdx] = this.ownership[this.index(x, y)] ?? EMPTY;
        newNuked[newIdx] = this.nuked[this.index(x, y)] ?? 0;
      }
    }

    Object.assign(this, {
      width: newSize,
      height: newSize,
      minX: newMinX,
      minY: newMinY,
      maxX: newMinX + newSize - 1,
      maxY: newMinY + newSize - 1,
      ownership: newOwnership,
      nuked: newNuked,
    });
  }

  bounds(): GridBounds {
    return {
      min_x: this.minX,
      min_y: this.minY,
      max_x: this.maxX,
      max_y: this.maxY,
    };
  }

  forEachCell(
    fn: (x: number, y: number, owner: number, nuked: boolean) => void,
  ): void {
    for (let y = this.minY; y <= this.maxY; y++) {
      for (let x = this.minX; x <= this.maxX; x++) {
        fn(x, y, this.getOwner(x, y), this.isNuked(x, y));
      }
    }
  }
}
