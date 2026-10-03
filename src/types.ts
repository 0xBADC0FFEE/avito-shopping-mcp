export interface SearchItem {
  article: number;
  name: string | null;
  brand: string | null;
  price: number;
  oldPrice: number | null;
  discountPercent: number | null;
  rating: number | null;
  reviewCount: number | null;
  seller: string | null;
  url: string;
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
  url: string;
}

export interface ProductDetails {
  article: number;
  name: string | null;
  brand: string | null;
  category: string | null;
  url: string;
  price: number | null;
  oldPrice: number | null;
  available: boolean;
  rating: number | null;
  reviewCount: number | null;
  seller: Seller | null;
  images: string[];
  characteristics: Record<string, string>;
  description: string | null;
  pricingContext: string;
}

export interface ProductReview {
  author: string | null;
  score: number | null;
  comment: string;
  pros: string;
  cons: string;
  variant: string | null;
  date: string | null;
  useful: number | null;
  hasPhotos: boolean;
}

export interface ReviewsResult {
  rating: number | null;
  totalReviews: number | null;
  count: number;
  reviews: ProductReview[];
}
