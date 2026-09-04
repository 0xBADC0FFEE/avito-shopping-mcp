export interface SearchItem {
  sku: string;
  name: string | null;
  price: number;
  oldPrice: number | null;
  discount: string | null;
  rating: number | null;
  reviewCount: number | null;
  url: string | null;
  image: string | null;
}

export interface SearchResult {
  query: string;
  sort: string;
  count: number;
  items: SearchItem[];
  pricingContext: string;
}

export interface Seller {
  name: string;
  rating: number | null;
  url: string | null;
}

export interface ProductDetails {
  sku: string | null;
  name: string | null;
  url: string | null;
  price: number | null;
  regularPrice: number | null;
  oldPrice: number | null;
  available: boolean | null;
  rating: number | null;
  reviewCount: number | null;
  seller: Seller | null;
  images: string[];
  characteristics: Record<string, string>;
  pricingContext: string;
}

export interface ProductReview {
  author: string | null;
  score: number | null;
  comment: string;
  pros: string;
  cons: string;
  date: string | null;
  useful: number | null;
  purchased: boolean | null;
  hasPhotos: boolean;
}

export interface ReviewsResult {
  rating: number | null;
  totalReviews: number | null;
  count: number;
  reviews: ProductReview[];
}
