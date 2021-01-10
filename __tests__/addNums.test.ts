import { addNums } from '../src/'

describe('addNums', () => {
  it('should return 8 for inputs 3, 5', () => {
    expect(addNums(3, 5)).toStrictEqual(8)
  })
})
